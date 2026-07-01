/**
 * Creates the VOD document in insight-api (MongoDB `vods`) for a Live2VOD clip,
 * mirroring the legacy `createClip` result but WITHOUT triggering insight-api's
 * internal transcoding pipeline (we use the immergo encoder instead).
 *
 * Two-step write (insight-api auto-generates `guid` on insert):
 *   1) insertOrUpdate base doc  -> read back `guid` + `_id`
 *   2) insertOrUpdate `_id` + `content[]` built from that `guid`
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
 * Pre-populated `content[]` matching legacy createClip:
 * poster + mp4 per rendition + hls master (default) + clipInfo.
 * @param {Array<{ publicUrl: string, assetType: string, mime: string, format: string, default: boolean }>} [uploadedPosters]
 */
function buildContent(spec, urls, renditions, uploadedPosters = []) {
  const now = Date.now();
  const content = [];

  if (uploadedPosters.length > 0) {
    for (const p of uploadedPosters) {
      content.push({
        assetTypes: [p.assetType],
        downloadUrl: p.publicUrl,
        mime_type: p.mime,
        format: p.format,
        type: "image",
        medium: "image",
        typeName: p.assetType,
        name: p.default ? "Thumbnail at video" : "Poster",
        default: p.default,
        status: "finish",
        created: now,
        updated: now,
      });
    }
  } else {
    content.push({
      assetTypes: ["Poster H"],
      downloadUrl: urls.posterUrl,
      mime_type: "image/jpeg",
      format: "jpg",
      type: "image",
      medium: "image",
      typeName: "Poster H",
      name: "Thumbnail at video",
      default: true,
      status: "pending",
      created: now,
      updated: now,
    });
  }

  for (const entry of urls.mp4Entries || []) {
    content.push({
      assetTypes: ["mp4"],
      resolution: entry.resolution,
      downloadUrl: entry.url,
      mime_type: "video/mp4",
      format: "mp4",
      type: "video",
      medium: "video",
      name: entry.resolution,
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

  let uploadedPosters = [];
  if (s3?.bucket && s3?.key && s3?.secret) {
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
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[insight-vod] editor poster upload failed guid=${guid} tenant=${tenantId}: ${m}`);
    }
  }

  const content = buildContent(spec, urls, renditions, uploadedPosters);
  await axios.post(url, { _id: vodId, accountId, content }, { headers });

  const whisperLang = resolveWhisperSubtitleLanguageFromSpec(spec);
  if (anyWhisperSubtitlesEnabled(spec)) {
    console.log(
      `[insight-vod] create guid=${guid} whisper subtitle labels name=${whisperLang.name} lang=${whisperLang.iso2}`,
    );
  }

  return { vodId: String(vodId), guid, masterUrl: urls.masterUrl };
}
