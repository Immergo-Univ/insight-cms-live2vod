/**
 * AI page "Run" actions on an existing Insight VOD (Speech-to-text, News article, Subtitles).
 *
 * Each run is a transcribe-only encoder job (`realtimeTranscribeOnly`) over the VOD source,
 * tagged with `editorSpec.__aiRun`. The job intentionally has no `vodGuid` column so it never
 * replaces the VOD's encode job. On completion:
 *   - stt / article merge into transcript[] / news[]
 *   - subtitles turn the timed (and, when a target language was requested, translated) cues
 *     into a WebVTT sidecar next to the VOD and upsert a Subtitles content item.
 */

import { getSequelize } from "../db/sequelize.js";
import { getTenantCreditState } from "./tenant-credits.service.js";
import { aiServiceCreditsPerMinute, estimateAiActionCredits } from "./credits-pricing.service.js";
import { resolveTenant } from "./auth.service.js";
import { startBackgroundVodJob } from "./vod-encode-runner.service.js";
import { listAiRunJobsForVod, mergeJobEditorSpec } from "./vod-jobs.store.js";
import { resolveTenantS3 } from "./tenant-storage.service.js";
import { putTenantTranscodedObject } from "./vod-tenant-s3.service.js";
import { vodOutputUrls } from "./vod-output-layout.js";
import {
  buildInsightNewsArray,
  buildInsightTranscriptArray,
  fetchInsightVodBestMp4Url,
  findInsightVodByGuid,
  updateInsightVodAiByGuid,
  upsertInsightVodSubtitleAsset,
} from "./insight-vod.service.js";
import { whisperLanguageMeta } from "./subtitle-language-utils.js";

export const AI_RUN_SERVICES = ["stt", "article", "subtitles"];
/** Locales produced by the news agent (trilingual draft). */
export const NEWS_LOCALES = ["en", "es", "he"];
/** Used when the VOD duration is unknown; ffmpeg stops at end of input. */
const FALLBACK_MAX_DURATION_SEC = 4 * 3600;
const ACTIVE_STATUSES = new Set(["queued", "processing", "uploading"]);

/**
 * @param {number} status
 * @param {string} message
 * @param {string} [code]
 */
function httpError(status, message, code) {
  const err = /** @type {Error & { status?: number, code?: string }} */ (new Error(message));
  err.status = status;
  if (code) err.code = code;
  return err;
}

/**
 * Clip duration in seconds from Insight content[] (max `duration`; values above a day are treated as ms).
 * @param {Record<string, unknown> | null | undefined} vod
 * @returns {number}
 */
export function resolveVodDurationSec(vod) {
  let best = 0;
  const content = Array.isArray(vod?.content) ? vod.content : [];
  for (const item of content) {
    let d = Number(item?.duration);
    if (!Number.isFinite(d) || d <= 0) continue;
    if (d > 86400) d = d / 1000;
    if (d > best) best = d;
  }
  const top = Number(vod?.duration);
  if (best <= 0 && Number.isFinite(top) && top > 0) best = top > 86400 ? top / 1000 : top;
  return Math.round(best * 10) / 10;
}

/**
 * HLS master from content[] (fallback when no MP4 is available).
 * @param {Record<string, unknown>} vod
 * @returns {string | null}
 */
function resolveVodHlsUrl(vod) {
  const content = Array.isArray(vod?.content) ? vod.content : [];
  const hls = content.find(
    (c) =>
      Array.isArray(c?.assetTypes) &&
      c.assetTypes.some((t) => String(t).toLowerCase() === "hls") &&
      /^https?:\/\//i.test(String(c?.downloadUrl || "")),
  );
  return hls ? String(hls.downloadUrl).trim() : null;
}

/**
 * @param {string} tenantId
 * @returns {Promise<{ availableLanguages: string[], diarization: boolean }>}
 */
async function tenantAiDefaults(tenantId) {
  const sequelize = getSequelize();
  const row = sequelize ? await sequelize.models.Tenant.findByPk(tenantId).catch(() => null) : null;
  const langs = Array.isArray(row?.get("availableLanguages")) ? row.get("availableLanguages") : ["en", "es", "he"];
  return {
    availableLanguages: langs.map((l) => String(l || "").trim().toLowerCase()).filter(Boolean),
    diarization: row ? row.get("subtitlesDefaultDiarization") !== false : true,
  };
}

/**
 * Compact run summary for the AI page.
 * @param {import("./vod-jobs.store.js").VodJob} job
 */
function serializeRun(job) {
  const run = job.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec.__aiRun || {} : {};
  return {
    id: job.id,
    service: String(run.service || ""),
    languages: Array.isArray(run.languages) ? run.languages : [],
    estimatedCredits: Number(run.estimatedCredits) || 0,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    message: job.message ?? null,
    error: job.error ?? null,
    synced: job.editorSpec?.__aiRunSynced === true,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt ?? null,
  };
}

/**
 * @param {string} tenantId
 * @param {string} vodGuid
 */
export async function listAiRunsForVod(tenantId, vodGuid) {
  const jobs = await listAiRunJobsForVod(tenantId, vodGuid, 20);
  return jobs.map(serializeRun);
}

/**
 * Per-language credit estimate for an AI action on this VOD.
 * @param {string} service
 * @param {number} durationSec
 */
export function estimateRunCreditsPerLanguage(service, durationSec) {
  const rates = aiServiceCreditsPerMinute();
  const rate = rates[service] ?? rates.stt;
  return estimateAiActionCredits(rate, durationSec);
}

/**
 * Language options + rates for the AI page.
 * @param {string} tenantId
 * @param {Record<string, unknown>} vod
 */
export async function getAiRunOptions(tenantId, vod) {
  const defaults = await tenantAiDefaults(tenantId);
  return {
    durationSec: resolveVodDurationSec(vod),
    creditsPerMinute: aiServiceCreditsPerMinute(),
    languages: {
      stt: ["auto", ...defaults.availableLanguages.filter((l) => l !== "auto")],
      article: NEWS_LOCALES.slice(),
      subtitles: defaults.availableLanguages.filter((l) => l !== "auto"),
    },
  };
}

/**
 * Start a Speech-to-text, News article, or Subtitles run on a VOD.
 * STT and Subtitles start one job per language; the article starts one job for every locale.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.vodGuid
 * @param {string} opts.service 'stt' | 'article' | 'subtitles'
 * @param {string[]} opts.languages
 */
export async function startAiRun({ tenantId, vodGuid, service, languages }) {
  if (!AI_RUN_SERVICES.includes(service)) {
    throw httpError(400, "This AI service cannot be run from this page yet", "SERVICE_NOT_SUPPORTED");
  }
  const requested = [
    ...new Set((Array.isArray(languages) ? languages : []).map((l) => String(l || "").trim().toLowerCase()).filter(Boolean)),
  ];
  if (requested.length === 0) throw httpError(400, "Pick at least one language", "NO_LANGUAGES");

  const vod = await findInsightVodByGuid(tenantId, vodGuid);
  if (!vod) throw httpError(404, "VOD not found");

  const options = await getAiRunOptions(tenantId, vod);
  const allowed = new Set(options.languages[service]);
  const invalid = requested.filter((l) => !allowed.has(l));
  if (invalid.length) throw httpError(400, `Unsupported language(s): ${invalid.join(", ")}`, "INVALID_LANGUAGE");

  const running = (await listAiRunJobsForVod(tenantId, vodGuid, 20)).some((j) => {
    const run = j.editorSpec?.__aiRun;
    return ACTIVE_STATUSES.has(j.status) && run?.service === service;
  });
  if (running) throw httpError(409, "This AI action is already running on this VOD", "ALREADY_RUNNING");

  const durationSec = options.durationSec;
  const perLanguage = estimateRunCreditsPerLanguage(service, durationSec);
  const jobsToStart = service === "article" ? [requested] : requested.map((l) => [l]);
  const estimatedTotal = perLanguage * requested.length;

  const state = await getTenantCreditState(tenantId);
  if (state?.limiterActive && (state.totalRemaining <= 0 || state.totalRemaining < estimatedTotal)) {
    throw httpError(402, "Not enough credits for this AI action", "NO_CREDITS");
  }

  const sourceUrl = (await fetchInsightVodBestMp4Url({ tenantId, vodGuid })) || resolveVodHlsUrl(vod);
  if (!sourceUrl) throw httpError(422, "This VOD has no playable source (MP4 or HLS)", "NO_SOURCE");

  const endTime = durationSec > 0 ? durationSec : FALLBACK_MAX_DURATION_SEC;
  const defaults = await tenantAiDefaults(tenantId);

  /** @type {string[]} */
  const jobIds = [];
  for (const langs of jobsToStart) {
    const outputLang = service === "article" || langs[0] === "auto" ? "same" : langs[0];
    const spec = {
      clipUrl: sourceUrl,
      sourceM3u8: "",
      startTime: 0,
      endTime,
      posters: [],
      ads: [],
      clips: [
        {
          order: 0,
          startTime: 0,
          endTime,
          subtitles: {
            enabled: true,
            burnIn: false,
            whisperSourceLanguage: "auto",
            whisperOutputLanguage: outputLang,
            ...(service === "subtitles" ? { subtitleLocales: { [langs[0]]: true } } : {}),
          },
        },
      ],
      ...(service === "subtitles" ? { subtitleLanguages: langs } : {}),
      realtimeTranscribeOnly: true,
      // Subtitle cues need timestamps, so diarization stays on for that service.
      transcribeSpeakerDiarization: service === "subtitles" ? true : defaults.diarization,
      transcribeGenerateNews: service === "article",
      ...(service === "article"
        ? { transcribeNewsLocales: Object.fromEntries(NEWS_LOCALES.map((l) => [l, langs.includes(l)])) }
        : {}),
      __aiRun: {
        vodGuid,
        service,
        languages: langs,
        estimatedCredits: perLanguage * langs.length,
        requestedAt: new Date().toISOString(),
      },
    };
    const jobId = await startBackgroundVodJob({ tenantId, spec, clipUrlPreview: sourceUrl });
    jobIds.push(jobId);
  }
  console.log(
    `[vod-ai-runs] started service=${service} langs=[${requested.join(",")}] guid=${vodGuid} tenant=${tenantId} jobs=${jobIds.join(",")}`,
  );
  return { jobIds, estimatedCredits: estimatedTotal };
}

/**
 * `HH:MM:SS.mmm` for a WebVTT cue (segment times are seconds).
 * @param {number} sec
 */
function formatVttTimestamp(sec) {
  const ms = Math.max(0, Math.round(Number(sec) * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
}

/**
 * Timed cues from a diarized transcript. Cue text is already in the requested language
 * when the job set whisperOutputLanguage (the encoder translates each cue).
 * @param {unknown} diarization
 * @returns {string} WebVTT document, or "" when there are no usable cues
 */
function diarizationToVtt(diarization) {
  const segments =
    diarization && typeof diarization === "object" && Array.isArray(/** @type {{ segments?: unknown }} */ (diarization).segments)
      ? /** @type {{ segments: Array<Record<string, unknown>> }} */ (diarization).segments
      : [];
  /** @type {string[]} */
  const cues = [];
  for (const seg of segments) {
    const text = String(seg?.text || "").replace(/\s+/g, " ").trim();
    const start = Number(seg?.start);
    const end = Number(seg?.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    cues.push(`${formatVttTimestamp(start)} --> ${formatVttTimestamp(end)}\n${text}`);
  }
  if (!cues.length) return "";
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/**
 * Upload a WebVTT sidecar beside the VOD output and attach it as a Subtitles content item.
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @param {string} vodGuid
 * @param {string} languageCode
 */
async function publishSubtitleVtt(job, vodGuid, languageCode) {
  const vtt = diarizationToVtt(job.transcriptDiarization);
  if (!vtt) throw new Error("Subtitle run produced no timed cues");

  const { accountId } = await resolveTenant(job.tenantId);
  const s3 = await resolveTenantS3({ accountId, tenantId: job.tenantId });
  if (!s3?.cdnBase) throw new Error("Tenant storage is not configured");

  const iso2 = whisperLanguageMeta(languageCode).iso2;
  const fileName = `hls/subs_whisper_${iso2}.vtt`;
  await putTenantTranscodedObject({
    s3,
    tenantId: job.tenantId,
    guid: vodGuid,
    fileName,
    body: Buffer.from(vtt, "utf8"),
    contentType: "text/vtt; charset=utf-8",
    cacheControl: "public, max-age=60",
  });
  const urls = vodOutputUrls({
    cdnBase: s3.cdnBase,
    tenantId: job.tenantId,
    guid: vodGuid,
    provider: s3.provider,
    bucket: s3.bucket,
    customerFolder: s3.customerFolder,
    pathStyle: s3.pathStyle,
  });
  await upsertInsightVodSubtitleAsset({
    tenantId: job.tenantId,
    vodGuid,
    languageCode: iso2,
    downloadUrl: `${urls.base}/${fileName}`,
  });
}

/**
 * Merge a completed AI run into the Insight VOD (transcript and/or news by language). Idempotent.
 * @param {import("./vod-jobs.store.js").VodJob | null | undefined} job
 * @returns {Promise<boolean>}
 */
export async function syncAiRunJobToInsightVod(job) {
  const run = job?.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec.__aiRun : null;
  if (!run || typeof run !== "object" || job.status !== "completed") return false;
  if (job.editorSpec.__aiRunSynced === true) return false;
  const vodGuid = String(run.vodGuid || "").trim();
  if (!vodGuid || !job.tenantId) return false;

  const languages = Array.isArray(run.languages) ? run.languages.map((l) => String(l)) : [];
  let transcript = buildInsightTranscriptArray(job);
  if (run.service === "stt" && transcript.length && languages[0] && languages[0] !== "auto") {
    const meta = whisperLanguageMeta(languages[0]);
    transcript = transcript.map((t) => ({ ...t, languageCode: meta.iso2, language: meta.name.toLowerCase() }));
  }

  if (run.service === "subtitles") {
    const languageCode = languages.find((l) => l && l !== "auto");
    if (!languageCode) return false;
    await publishSubtitleVtt(job, vodGuid, languageCode);
    await mergeJobEditorSpec(job.id, (prev) => ({ ...(prev || {}), __aiRunSynced: true })).catch(() => {});
    console.log(`[vod-ai-runs] synced job=${job.id} service=subtitles lang=${languageCode} guid=${vodGuid}`);
    return true;
  }

  /** @type {Record<string, unknown>} */
  const update = { tenantId: job.tenantId, vodGuid, replaceNews: false, replaceTranscript: false };
  if (run.service === "stt") {
    if (!transcript.length) return false;
    update.transcript = transcript;
  } else if (run.service === "article") {
    const news = buildInsightNewsArray(job).filter((n) => languages.includes(String(n.languageCode)));
    if (!news.length) return false;
    update.news = news;
    const vod = await findInsightVodByGuid(job.tenantId, vodGuid);
    const hasTranscript = Array.isArray(vod?.transcript) && vod.transcript.length > 0;
    if (!hasTranscript && transcript.length) update.transcript = transcript;
  } else {
    return false;
  }

  await updateInsightVodAiByGuid(/** @type {any} */ (update));
  await mergeJobEditorSpec(job.id, (prev) => ({ ...(prev || {}), __aiRunSynced: true })).catch(() => {});
  console.log(`[vod-ai-runs] synced job=${job.id} service=${run.service} guid=${vodGuid} tenant=${job.tenantId}`);
  return true;
}

/**
 * Fire-and-forget wrapper used by the encoder callback.
 * @param {import("./vod-jobs.store.js").VodJob | null | undefined} job
 */
export async function trySyncAiRunJobToInsightVod(job) {
  try {
    await syncAiRunJobToInsightVod(job);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(`[vod-ai-runs] sync failed job=${job?.id}: ${m}`);
  }
}
