/**
 * Load Whisper transcript text from public encode artifacts (SRT/VTT on CDN)
 * when the agent did not PATCH transcriptText to the BFF job (e.g. missing CMS_CALLBACK on pods).
 */

import { resolveTenant } from "./auth.service.js";
import { resolveTenantS3 } from "./tenant-storage.service.js";
import { resolveTenantVideoProfiles } from "./video-profiles.service.js";
import { vodOutputUrls } from "./vod-output-layout.js";
import { getJob, updateJob } from "./vod-jobs.store.js";
import { subtitleLanguagesFromSpec } from "./subtitle-language-utils.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string} srtContent */
export function parseSrtContentToPlainText(srtContent) {
  const lines = String(srtContent || "").split(/\r?\n/);
  /** @type {string[]} */
  const blocks = [];
  let mode = 0;
  /** @type {string[]} */
  let buf = [];
  for (const line of lines) {
    if (mode === 0) {
      if (/^\d+$/.test(line.trim())) mode = 1;
      continue;
    }
    if (mode === 1) {
      if (line.includes("-->")) mode = 2;
      continue;
    }
    if (mode === 2) {
      const t = line.trim();
      if (t === "") {
        if (buf.length) blocks.push(buf.join(" "));
        buf = [];
        mode = 0;
      } else {
        buf.push(t);
      }
    }
  }
  if (buf.length) blocks.push(buf.join(" "));
  return blocks.join("\n\n").trim();
}

/** @param {string} vttContent */
export function parseVttContentToPlainText(vttContent) {
  const lines = String(vttContent || "").split(/\r?\n/);
  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  let buf = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("WEBVTT") || line.startsWith("NOTE") || line.startsWith("STYLE")) {
      continue;
    }
    if (line.includes("-->")) {
      if (buf.length) blocks.push(buf.join(" "));
      buf = [];
      continue;
    }
    if (/^\d+$/.test(line)) continue;
    buf.push(line);
  }
  if (buf.length) blocks.push(buf.join(" "));
  return blocks.join("\n\n").trim();
}

/** @param {object | null | undefined} spec */
function whisperSubtitlesEnabledInSpec(spec) {
  if (!spec || typeof spec !== "object") return false;
  if (spec.subtitles?.enabled === true) return true;
  return Array.isArray(spec.clips) && spec.clips.some((c) => c?.subtitles?.enabled === true);
}

/**
 * @param {import("./vod-jobs.store.js").VodJob} job
 */
async function whisperArtifactUrlsForJob(job) {
  const guid = job.vodGuid;
  if (!guid || !job.tenantId) return null;
  const { accountId } = await resolveTenant(job.tenantId);
  const s3 = await resolveTenantS3({ accountId, tenantId: job.tenantId }).catch(() => null);
  if (!s3?.cdnBase) return null;
  let renditions = [];
  try {
    renditions = (await resolveTenantVideoProfiles({ accountId, tenantId: job.tenantId })) || [];
  } catch {
    /* optional */
  }
  const urls = vodOutputUrls({
    cdnBase: s3.cdnBase,
    tenantId: job.tenantId,
    guid,
    provider: s3.provider,
    bucket: s3.bucket,
    customerFolder: s3.customerFolder,
    renditions,
  });
  const spec = job.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec : null;
  const langs = subtitleLanguagesFromSpec(spec);
  const useLegacyNames = langs.length <= 1;
  /** @type {Array<{ srtUrl: string, vttUrl: string, label?: string }>} */
  const candidates = [];
  if (useLegacyNames) {
    candidates.push({
      srtUrl: `${urls.base}/subs/whisper.srt`,
      vttUrl: urls.whisperSubsUrl,
      label: "legacy",
    });
  } else {
    for (const code of langs) {
      candidates.push({
        srtUrl: `${urls.base}/subs/whisper_${code}.srt`,
        vttUrl: `${urls.base}/hls/subs_whisper_${code}.vtt`,
        label: code,
      });
    }
    candidates.push({
      srtUrl: `${urls.base}/subs/whisper.srt`,
      vttUrl: urls.whisperSubsUrl,
      label: "legacy-fallback",
    });
  }
  return { base: urls.base, candidates };
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function fetchText(url, timeoutMs = 20_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

/**
 * @typedef {(
 *   | "already_present"
 *   | "missing_job_or_guid"
 *   | "subtitles_not_requested"
 *   | "no_cdn_urls"
 *   | "artifacts_not_found"
 *   | "empty_transcript"
 *   | "ok"
 * )} WhisperBackfillReason
 */

/**
 * @typedef {object} WhisperBackfillResult
 * @property {boolean} ok
 * @property {WhisperBackfillReason} reason
 * @property {import("./vod-jobs.store.js").VodJob | null} job
 * @property {{ srtUrl?: string, vttUrl?: string }} [urls]
 * @property {string} [detail] last fetch/parse error, for diagnostics
 */

/**
 * Backfill the Whisper transcript from public CDN artifacts and report a precise reason,
 * so the UI can tell the user WHY it is empty (subtitles off, artifacts missing, etc.).
 *
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @param {{ maxAttempts?: number }} [opts]
 * @returns {Promise<WhisperBackfillResult>}
 */
export async function backfillWhisperTranscriptDetailed(job, opts = {}) {
  if (!job?.id || !job.vodGuid) {
    return { ok: false, reason: "missing_job_or_guid", job: job ?? null };
  }
  if (String(job.transcriptText || "").trim()) {
    return { ok: true, reason: "already_present", job };
  }
  const spec = job.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec : null;
  if (!whisperSubtitlesEnabledInSpec(spec)) {
    return { ok: false, reason: "subtitles_not_requested", job };
  }

  const artifactSet = await whisperArtifactUrlsForJob(job);
  if (!artifactSet?.candidates?.length) {
    console.warn(`[whisper-backfill] no CDN URLs job=${job.id} guid=${job.vodGuid}`);
    return { ok: false, reason: "no_cdn_urls", job };
  }

  const maxAttempts = opts.maxAttempts ?? 4;
  /** @type {string} */
  let transcriptText = "";
  /** @type {string} */
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const pair of artifactSet.candidates) {
      try {
        try {
          const srt = await fetchText(pair.srtUrl);
          transcriptText = parseSrtContentToPlainText(srt);
        } catch (srtErr) {
          lastError = srtErr instanceof Error ? srtErr.message : String(srtErr);
          try {
            const vtt = await fetchText(pair.vttUrl);
            transcriptText = parseVttContentToPlainText(vtt);
          } catch (vttErr) {
            lastError = vttErr instanceof Error ? vttErr.message : String(vttErr);
            continue;
          }
        }
        if (transcriptText.trim()) break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    if (transcriptText.trim()) break;
    if (attempt < maxAttempts - 1) await sleep(1500 * (attempt + 1));
  }

  if (!transcriptText.trim()) {
    return {
      ok: false,
      reason: lastError ? "artifacts_not_found" : "empty_transcript",
      job,
      urls: { srtUrl: urls.srtUrl, vttUrl: urls.vttUrl },
      detail: lastError || undefined,
    };
  }

  const updated = await updateJob(job.id, {
    transcriptText: transcriptText.trim(),
    message: "Transcript loaded from encode artifacts",
  });
  console.log(
    `[whisper-backfill] stored transcript job=${job.id} guid=${job.vodGuid} chars=${transcriptText.length}`,
  );
  return { ok: true, reason: "ok", job: updated };
}

/**
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @param {{ maxAttempts?: number }} [opts]
 * @returns {Promise<import("./vod-jobs.store.js").VodJob | null>}
 */
export async function tryBackfillWhisperTranscriptForJob(job, opts = {}) {
  const result = await backfillWhisperTranscriptDetailed(job, opts);
  return result.ok ? result.job : null;
}

/**
 * @param {string} jobId
 * @returns {Promise<WhisperBackfillResult>}
 */
export async function backfillWhisperTranscriptByJobId(jobId) {
  const job = await getJob(jobId);
  if (!job) return { ok: false, reason: "missing_job_or_guid", job: null };
  return backfillWhisperTranscriptDetailed(job, { maxAttempts: 6 });
}
