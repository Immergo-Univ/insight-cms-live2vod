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
import { getAuthToken } from "./auth.service.js";
import { vodOutputUrls } from "./vod-output-layout.js";
import { resolveWhisperSubtitleLanguageFromSpec } from "./subtitle-language-utils.js";

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
 */
function buildContent(spec, urls, renditions) {
  const now = Date.now();
  const content = [
    {
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
    },
  ];

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

  if (anyWhisperSubtitlesEnabled(spec) && urls.whisperSubsUrl) {
    const whisperLang = resolveWhisperSubtitleLanguageFromSpec(spec);
    content.push({
      assetTypes: ["Subtitles"],
      downloadUrl: urls.whisperSubsUrl,
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

  return content;
}

/**
 * @param {object} opts
 * @param {string} opts.accountId  insight-api account ObjectId
 * @param {string} opts.tenantId   tenant code (x-tenant-id)
 * @param {object} opts.spec       EditorStateJson
 * @param {object} [opts.s3]       resolved tenant S3 (uses s3.cdnBase for public URLs)
 * @param {string} [opts.customerFolder] legacy customer folder override
 * @param {Array<object>} [opts.renditions] tenant video profiles (encoder shape)
 * @returns {Promise<{ vodId: string, guid: string, masterUrl: string }>}
 */
export async function createInsightVod({
  accountId,
  tenantId,
  spec,
  s3,
  customerFolder,
  renditions = [],
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
  const content = buildContent(spec, urls, renditions);
  await axios.post(url, { _id: vodId, accountId, content }, { headers });

  return { vodId: String(vodId), guid, masterUrl: urls.masterUrl };
}
