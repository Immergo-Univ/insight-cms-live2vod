/**
 * Creates the VOD document in insight-api (MongoDB `vods`) for a Live2VOD clip,
 * mirroring the legacy `createClip` result but WITHOUT triggering insight-api's
 * internal transcoding pipeline (we use the immergo encoder instead).
 *
 * Two-step write (insight-api auto-generates `guid` on insert):
 *   1) insertOrUpdate base doc  -> read back `guid` + `_id`
 *   2) insertOrUpdate `_id` + `content[]` built from that `guid`
 *
 * After STT/news complete, `syncInsightVodTranscriptAndNews` PATCHes the same VOD with
 * top-level `transcript[]` and `news[]` arrays (language + payload per locale).
 *
 * `guid` is the shared key: it is the legacy webhook `media_id`, the S3 path
 * segment and the base for the pre-populated `content[]` URLs.
 *
 * See insight-api/LIVE2VOD-CONTRACTS.md and docs/live2vod-immergo-integration.md.
 */

import axios from "axios";
import { config } from "../config.js";
import { getAuthToken, resolveTenant } from "./auth.service.js";
import { vodOutputUrls } from "./vod-output-layout.js";
import { uploadEditorPostersForVod } from "./vod-poster-upload.service.js";
import {
  extensionFromDownloadUrl,
  mimeTypeForImageFormat,
  resolveInsightContentTypes,
} from "./insight-content-types.service.js";
import {
  resolveWhisperSubtitleLanguage,
  resolveWhisperSubtitleLanguageFromSpec,
  subtitleLanguagesFromSpec,
  whisperLanguageMeta,
} from "./subtitle-language-utils.js";

/** Title/description/keywords from the editor spec (clip metadata first, then root). */
function extractMetadata(spec) {
  const m = spec?.clips?.[0]?.metadata || spec?.metadata || {};
  const title =
    m.title || spec?.clips?.[0]?.title || `Live2VOD ${new Date().toISOString().slice(0, 10)}`;
  const description = m.description || spec?.clips?.[0]?.description || "";
  const keywords = Array.isArray(m.tags) ? m.tags.filter(Boolean) : [];
  const mainCategory = Array.isArray(m.mainCategory) ? m.mainCategory : undefined;
  return { title, description, keywords, mainCategory };
}

/** True when any clip (or root) requests Whisper subtitles. */
function anyWhisperSubtitlesEnabled(spec) {
  if (spec?.subtitles && typeof spec.subtitles === "object" && spec.subtitles.enabled === true) {
    return true;
  }
  return Array.isArray(spec?.clips) && spec.clips.some((c) => c?.subtitles?.enabled === true);
}

/** Legacy-style clipInfo content entry. Times in ms, duration in seconds (placeholder until finish). */
function buildClipInfo(spec) {
  const clips = Array.isArray(spec?.clips) ? spec.clips : [];
  const first = clips[0] || {};
  const durationSec = clips.reduce(
    (acc, c) => acc + Math.max(0, (Number(c?.endTime) || 0) - (Number(c?.startTime) || 0)),
    0,
  );
  return {
    assetTypes: ["clipInfo"],
    timeFrom: Math.round((Number(first.startTime) || 0) * 1000),
    timeTo: Math.round((Number(first.endTime) || 0) * 1000),
    m3u8: spec?.clipUrl || spec?.sourceM3u8 || "",
    type: "info",
    duration: Math.round(durationSec),
  };
}

/**
 * Legacy createClip-style poster content entry (posterTypes + finish/pending status).
 * @param {object} opts
 * @param {string} opts.downloadUrl
 * @param {string} opts.assetType
 * @param {object} [opts.posterType]
 * @param {boolean} opts.isDefault
 * @param {"pending"|"finish"} opts.status
 * @param {number} opts.now
 */
function buildPosterContentEntry({ downloadUrl, assetType, posterType, isDefault, status, now }) {
  const format = extensionFromDownloadUrl(downloadUrl);
  const pt = posterType && typeof posterType === "object" ? posterType : {};
  const name = pt.title || (isDefault ? "Thumbnail at video" : "Poster");
  return {
    assetTypes: [assetType],
    downloadUrl,
    mime_type: mimeTypeForImageFormat(format),
    format,
    type: "image",
    medium: "image",
    typeName: assetType,
    ...(pt._id ? { type_id: String(pt._id) } : {}),
    ...(pt.title ? { typeAlias: pt.title } : {}),
    ...(pt.aspect ? { aspectRatio: pt.aspect } : {}),
    name,
    default: isDefault,
    status,
    created: now,
    updated: now,
  };
}

/**
 * Pre-populated `content[]` matching legacy createClip:
 * poster + mp4 per rendition + hls master (default) + clipInfo.
 * @param {Array<{ publicUrl: string, assetType: string, mime: string, format: string, default: boolean }>} [uploadedPosters]
 * @param {{ posterForAssetType?: (assetType: string) => object, videoType?: object } | null} [contentTypes]
 */
function buildContent(spec, urls, renditions, uploadedPosters = [], contentTypes = null) {
  const now = Date.now();
  const content = [];
  const posterForAssetType =
    typeof contentTypes?.posterForAssetType === "function"
      ? contentTypes.posterForAssetType
      : () => ({});
  const videoType = contentTypes?.videoType || { _id: null, name: "Main video" };

  if (uploadedPosters.length > 0) {
    for (const p of uploadedPosters) {
      content.push(
        buildPosterContentEntry({
          downloadUrl: p.publicUrl,
          assetType: p.assetType,
          posterType: posterForAssetType(p.assetType),
          isDefault: p.default,
          status: "finish",
          now,
        }),
      );
    }
  } else {
    content.push(
      buildPosterContentEntry({
        downloadUrl: urls.posterUrl,
        assetType: "Poster H",
        posterType: posterForAssetType("Poster H"),
        isDefault: true,
        status: "pending",
        now,
      }),
    );
  }

  for (const entry of urls.mp4Entries || []) {
    const profile = renditions.find(
      (r) => (r.res || r.resolution) === entry.resolution,
    );
    content.push({
      assetTypes: ["mp4"],
      resolution: entry.resolution,
      downloadUrl: entry.url,
      mime_type: "video/mp4",
      format: "mp4",
      type: "video",
      medium: "video",
      name: profile?.title || entry.resolution,
      ...(profile?.description ? { description: profile.description } : {}),
      typeName: videoType.name,
      ...(videoType._id ? { type_id: String(videoType._id) } : {}),
      ...(profile?.aspectRatio ? { aspectRatio: profile.aspectRatio } : {}),
      created: now,
      updated: now,
    });
  }

  const brList = renditions.map((r) => r.br || r.bitrate).filter(Boolean);
  content.push({
    assetTypes: ["hls"],
    resolution: "hls",
    downloadUrl: urls.masterUrl,
    mime_type: "application/x-mpegURL",
    format: "m3u8",
    type: "video",
    medium: "video",
    name: brList.length ? `HLS ${brList.join(", ")}` : "HLS ABR",
    description: "Adaptative Bitrate HLS",
    default: true,
    typeName: videoType.name,
    ...(videoType._id ? { type_id: String(videoType._id) } : {}),
    created: now,
    updated: now,
  });

  content.push(buildClipInfo(spec));

  if (anyWhisperSubtitlesEnabled(spec) && urls.base) {
    const langs = subtitleLanguagesFromSpec(spec);
    const useLegacyNames = langs.length <= 1;
    for (const iso2 of langs) {
      const whisperLang = whisperLanguageMeta(iso2);
      const downloadUrl = useLegacyNames
        ? urls.whisperSubsUrl
        : `${urls.base}/hls/subs_whisper_${whisperLang.iso2}.vtt`;
      content.push({
        assetTypes: ["Subtitles"],
        downloadUrl,
        mime_type: "text/vtt",
        format: "vtt",
        type: "text",
        medium: "Subtitles",
        typeName: "Subtitles",
        name: whisperLang.name,
        language: whisperLang.iso2,
        languageName: whisperLang.name,
        status: "pending",
        created: now,
        updated: now,
      });
    }
  }

  return content;
}

function isWhisperSidecarSubtitleItem(item) {
  if (!item || !Array.isArray(item.assetTypes)) return false;
  if (!item.assetTypes.includes("Subtitles")) return false;
  const url = String(item.downloadUrl || "").toLowerCase();
  return url.includes("subs_whisper") || /\/subs\/.*\.vtt(?:\?|$)/.test(url);
}

/**
 * Update Mongo `content[]` subtitle labels (name / language / languageName) for Immergo whisper sidecar.
 * Idempotent; no-ops when labels already match or the VOD cannot be loaded.
 *
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {string} opts.tenantId
 * @param {string} opts.vodGuid insight-api VOD guid (= originId / media_id)
 * @param {object} [opts.spec] editor spec for language resolution
 * @param {{ iso2?: string, name?: string }} [opts.languageOverride]
 */
export async function patchInsightVodWhisperSubtitleLabels({
  accountId,
  tenantId,
  vodGuid,
  spec,
  languageOverride,
}) {
  if (!accountId || !tenantId || !vodGuid) return false;

  const lang =
    languageOverride?.iso2 && languageOverride?.name
      ? {
          iso2: String(languageOverride.iso2),
          name: String(languageOverride.name),
          hlsLanguage:
            resolveWhisperSubtitleLanguage({
              whisperOutputLanguage: String(languageOverride.iso2),
              whisperSourceLanguage: "auto",
            }).hlsLanguage,
        }
      : resolveWhisperSubtitleLanguageFromSpec(spec);

  const token = await getAuthToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
  };
  const findUrl = `${config.insightApiBase}/cms/entity/vods/find`;
  const findRes = await axios.get(findUrl, {
    params: { filter: `guid||$eq||${vodGuid}` },
    headers,
  });
  const rows = Array.isArray(findRes.data) ? findRes.data : findRes.data ? [findRes.data] : [];
  const vod = rows[0];
  if (!vod?._id || !Array.isArray(vod.content)) return false;

  let changed = false;
  const content = vod.content.map((item) => {
    if (!isWhisperSidecarSubtitleItem(item)) return item;
    if (item.name === lang.name && item.languageName === lang.name && item.language === lang.iso2) {
      return item;
    }
    changed = true;
    return {
      ...item,
      name: lang.name,
      languageName: lang.name,
      language: lang.iso2,
      updated: Date.now(),
    };
  });

  if (!changed) return false;

  await axios.post(
    `${config.insightApiBase}/cms/entity/vods/insertOrUpdate`,
    { _id: vod._id, accountId: vod.accountId || accountId, content },
    { headers: { ...headers, "Content-Type": "application/json" } },
  );
  return true;
}

/**
 * Best-effort subtitle label sync after encode / STT (never throws).
 * @param {import("./vod-jobs.store.js").VodJob | null | undefined} job
 */
export async function trySyncInsightVodWhisperSubtitleLabels(job) {
  if (!job?.vodGuid || !job?.tenantId) return;
  const spec = job.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec : null;
  if (!anyWhisperSubtitlesEnabled(spec)) return;
  try {
    const { accountId } = await resolveTenant(job.tenantId);
    if (!accountId) return;
    const ok = await patchInsightVodWhisperSubtitleLabels({
      accountId,
      tenantId: job.tenantId,
      vodGuid: job.vodGuid,
      spec,
    });
    if (ok) {
      console.log(
        `[insight-vod] synced whisper subtitle labels guid=${job.vodGuid} tenant=${job.tenantId}`,
      );
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(`[insight-vod] subtitle label sync failed guid=${job.vodGuid}: ${m}`);
  }
}

/**
 * Insight language label: lowercase English name (e.g. "hebrew", "english").
 * @param {string} iso2
 */
function insightLanguageLabel(iso2) {
  return String(whisperLanguageMeta(iso2).name || iso2 || "english")
    .trim()
    .toLowerCase();
}

/**
 * Build `transcript[]` for insight-api from a Live2VOD job (raw STT + optional diarization).
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @returns {Array<Record<string, unknown>>}
 */
export function buildInsightTranscriptArray(job) {
  const text = String(job?.transcriptText || "").trim();
  const di =
    job?.transcriptDiarization &&
    typeof job.transcriptDiarization === "object" &&
    !Array.isArray(job.transcriptDiarization)
      ? job.transcriptDiarization
      : null;
  if (!text && !di) return [];

  const spec = job.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec : null;
  const lang = resolveWhisperSubtitleLanguageFromSpec(spec);
  /** @type {Record<string, unknown>} */
  const entry = {
    language: insightLanguageLabel(lang.iso2),
    languageCode: lang.iso2,
    text: text || "",
  };
  if (di) {
    entry.diarization = di;
  }
  return [entry];
}

/**
 * Build `news[]` for insight-api from transcriptNewsBundle + legacy plain fields.
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @returns {Array<Record<string, unknown>>}
 */
export function buildInsightNewsArray(job) {
  /** @type {Map<string, Record<string, unknown>>} */
  const byCode = new Map();

  const bundle =
    job?.transcriptNewsBundle &&
    typeof job.transcriptNewsBundle === "object" &&
    !Array.isArray(job.transcriptNewsBundle)
      ? /** @type {Record<string, unknown>} */ (job.transcriptNewsBundle)
      : {};

  for (const [key, raw] of Object.entries(bundle)) {
    if (key === "version") continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const code = String(key || "")
      .trim()
      .toLowerCase();
    if (!code) continue;
    const b = /** @type {Record<string, unknown>} */ (raw);
    byCode.set(code, {
      language: insightLanguageLabel(code),
      languageCode: code,
      title: String(b.title ?? "").trim(),
      description: String(b.description ?? b.subtitle ?? "").trim(),
      posterCaption: String(b.posterCaption ?? "").trim(),
      date: String(b.date ?? "").trim(),
      time: String(b.time ?? "").trim(),
      htmlBody: typeof b.htmlBody === "string" ? b.htmlBody : "",
      posterUrl: typeof b.posterUrl === "string" ? b.posterUrl : b.posterUrl ?? null,
      posterDataUrl: typeof b.posterDataUrl === "string" ? b.posterDataUrl : b.posterDataUrl ?? null,
    });
  }

  /** @type {Record<string, string>} */
  const legacy = {
    en: String(job?.transcriptNewsEn || "").trim(),
    es: String(job?.transcriptNewsEs || "").trim(),
    he: String(job?.transcriptNewsHe || "").trim(),
  };
  for (const [code, plain] of Object.entries(legacy)) {
    if (!plain || byCode.has(code)) continue;
    const nl = plain.indexOf("\n");
    const title = (nl === -1 ? plain : plain.slice(0, nl)).trim().slice(0, 200) || "News";
    const body = (nl === -1 ? plain : plain.slice(nl + 1)).trim() || plain;
    byCode.set(code, {
      language: insightLanguageLabel(code),
      languageCode: code,
      title,
      description: "",
      posterCaption: "",
      date: "",
      time: "",
      htmlBody: `<p>${body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>")}</p>`,
      posterUrl: null,
      posterDataUrl: null,
      text: plain,
    });
  }

  return [...byCode.values()];
}

/**
 * PATCH insight-api VOD with `transcript` + `news` arrays (schema-free Mongo fields).
 * Called when STT/news land on the job (encode callback or editor PATCH). Never throws to caller.
 *
 * @param {import("./vod-jobs.store.js").VodJob | null | undefined} job
 * @returns {Promise<boolean>}
 */
export async function syncInsightVodTranscriptAndNews(job) {
  if (!job?.vodGuid || !job?.tenantId) return false;

  const transcript = buildInsightTranscriptArray(job);
  const news = buildInsightNewsArray(job);
  if (transcript.length === 0 && news.length === 0) return false;

  try {
    const { accountId } = await resolveTenant(job.tenantId);
    if (!accountId) return false;

    const token = await getAuthToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "x-tenant-id": job.tenantId,
      "Content-Type": "application/json",
    };

    const findUrl = `${config.insightApiBase}/cms/entity/vods/find`;
    const findRes = await axios.get(findUrl, {
      params: { filter: `guid||$eq||${job.vodGuid}` },
      headers,
    });
    const rows = Array.isArray(findRes.data) ? findRes.data : findRes.data ? [findRes.data] : [];
    const vod = rows[0];
    if (!vod?._id) {
      console.warn(
        `[insight-vod] transcript/news sync skipped: no vod for guid=${job.vodGuid} tenant=${job.tenantId}`,
      );
      return false;
    }

    /** @type {Record<string, unknown>} */
    const patch = {
      _id: vod._id,
      accountId: vod.accountId || accountId,
    };
    if (transcript.length > 0) patch.transcript = transcript;
    if (news.length > 0) patch.news = news;

    await axios.post(`${config.insightApiBase}/cms/entity/vods/insertOrUpdate`, patch, { headers });
    console.log(
      `[insight-vod] synced transcript(${transcript.length}) news(${news.length}) ` +
        `guid=${job.vodGuid} tenant=${job.tenantId}`,
    );
    return true;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(`[insight-vod] transcript/news sync failed guid=${job.vodGuid}: ${m}`);
    return false;
  }
}

/**
 * Fire-and-forget wrapper for encode/editor paths.
 * @param {import("./vod-jobs.store.js").VodJob | null | undefined} job
 */
export async function trySyncInsightVodTranscriptAndNews(job) {
  try {
    await syncInsightVodTranscriptAndNews(job);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(`[insight-vod] trySyncInsightVodTranscriptAndNews: ${m}`);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.accountId  insight-api account ObjectId
 * @param {string} opts.tenantId   tenant code (x-tenant-id)
 * @param {object} opts.spec       EditorStateJson
 * @param {object} [opts.s3]       resolved tenant S3 (uses s3.cdnBase for public URLs)
 * @param {string} [opts.customerFolder] legacy customer folder override
 * @param {Array<object>} [opts.renditions] tenant video profiles (encoder shape)
 * @param {string} [opts.editorClipId] correlates posters to the encoded sub-clip
 * @returns {Promise<{ vodId: string, guid: string, masterUrl: string }>}
 */
export async function createInsightVod({
  accountId,
  tenantId,
  spec,
  s3,
  customerFolder,
  renditions = [],
  editorClipId,
}) {
  if (!accountId) throw new Error("createInsightVod: missing accountId");
  if (!tenantId) throw new Error("createInsightVod: missing tenantId");

  const token = await getAuthToken();
  const url = `${config.insightApiBase}/cms/entity/vods/insertOrUpdate`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
  };

  const meta = extractMetadata(spec);

  // Step 1: create the doc so insight-api assigns the guid.
  const baseDoc = {
    accountId,
    title: meta.title,
    description: meta.description,
    keywords: meta.keywords,
    publish_status: "pending",
    vodType: "clip",
    customerCode: tenantId,
    content: [],
    ...(meta.mainCategory ? { mainCategory: meta.mainCategory } : {}),
  };

  const insertRes = await axios.post(url, baseDoc, { headers });
  const created = insertRes.data || {};
  const guid = created.guid;
  const vodId = created._id;
  if (!guid || !vodId) {
    throw new Error(
      `insertOrUpdate vods did not return guid/_id (got keys: ${Object.keys(created).join(",")})`,
    );
  }

  // Step 2: now that we know the guid, persist the pre-populated content[].
  // URLs must line up byte-for-byte with where the encoder uploads (path-style aware).
  const folder = customerFolder || s3?.customerFolder;
  const urls = vodOutputUrls({
    cdnBase: s3?.cdnBase || "",
    tenantId,
    guid,
    provider: s3?.provider,
    bucket: s3?.bucket,
    customerFolder: folder,
    renditions,
  });

  const specPosterCount = Array.isArray(spec?.clips)
    ? spec.clips.reduce((n, c) => n + (Array.isArray(c?.posters) ? c.posters.length : 0), 0)
    : 0;

  let uploadedPosters = [];
  const s3Ready = Boolean(s3?.bucket && s3?.key && s3?.secret);
  if (!s3Ready) {
    console.warn(
      `[insight-vod] guid=${guid} tenant=${tenantId}: tenant S3 not resolved ` +
        `(bucket=${s3?.bucket ? "y" : "n"} key=${s3?.key ? "y" : "n"} secret=${s3?.secret ? "y" : "n"}); ` +
        `cannot upload ${specPosterCount} editor poster(s), falling back to placeholder poster`,
    );
  } else if (specPosterCount === 0) {
    console.log(`[insight-vod] guid=${guid} tenant=${tenantId}: no editor posters in spec`);
  } else {
    try {
      uploadedPosters = await uploadEditorPostersForVod({
        s3,
        tenantId,
        guid,
        spec,
        editorClipId,
        baseUrl: urls.base,
      });
      if (uploadedPosters.length > 0) {
        console.log(
          `[insight-vod] uploaded ${uploadedPosters.length} editor poster(s) guid=${guid} tenant=${tenantId}`,
        );
      } else {
        console.warn(
          `[insight-vod] guid=${guid} tenant=${tenantId}: spec had ${specPosterCount} poster(s) but none resolved/uploaded; using placeholder poster`,
        );
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[insight-vod] editor poster upload failed guid=${guid} tenant=${tenantId}: ${m}`);
    }
  }

  const contentTypes = await resolveInsightContentTypes({ accountId, tenantId }).catch(() => ({
    defaultPoster: {},
    posterForAssetType: () => ({}),
    videoType: { _id: null, name: "Main video" },
  }));

  const content = buildContent(spec, urls, renditions, uploadedPosters, contentTypes);
  await axios.post(url, { _id: vodId, accountId, content }, { headers });

  const whisperLang = resolveWhisperSubtitleLanguageFromSpec(spec);
  if (anyWhisperSubtitlesEnabled(spec)) {
    console.log(
      `[insight-vod] create guid=${guid} whisper subtitle labels name=${whisperLang.name} lang=${whisperLang.iso2}`,
    );
  }

  // Default poster for the public news page: the editor's uploaded default poster, else the
  // deterministic VOD poster.jpg (encoder-generated). Always a stable public CDN URL.
  const posterUrl =
    (uploadedPosters.find((p) => p.default) || uploadedPosters[0])?.publicUrl || urls.posterUrl;

  return { vodId: String(vodId), guid, masterUrl: urls.masterUrl, posterUrl };
}
