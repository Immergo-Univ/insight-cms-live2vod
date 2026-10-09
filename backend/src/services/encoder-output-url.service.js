/**
 * Resolve public playback/download URLs for a completed VOD encode job:
 *   - HLS master (`.m3u8`) for CMS playback.
 *   - Best MP4 for social syndication (prefers the Insight VOD content[] URL the app serves).
 * Uses the same CDN layout as insight-vod / vod-output-layout (not the S3 key prefix).
 */

import { resolveTenant } from "./auth.service.js";
import { resolveTenantS3 } from "./tenant-storage.service.js";
import { resolveTenantVideoProfiles } from "./video-profiles.service.js";
import { vodOutputUrls } from "./vod-output-layout.js";
import { resolveJobVodGuid } from "./vod-jobs.store.js";
import { fetchInsightVodBestMp4Url } from "./insight-vod.service.js";

/**
 * Resolve the full public URL set (HLS master + per-rendition MP4 list) for a completed job,
 * replicating the exact S3/CDN layout the encoder uploads to (shared `vodOutputUrls`).
 *
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @returns {Promise<ReturnType<typeof vodOutputUrls> | null>}
 */
async function resolveJobVodUrls(job) {
  if (!job?.tenantId) return null;
  const guid = resolveJobVodGuid(job);
  if (!guid) return null;

  try {
    const { accountId } = await resolveTenant(job.tenantId);
    const s3 = await resolveTenantS3({ accountId, tenantId: job.tenantId }).catch(() => null);
    if (!s3?.cdnBase) return null;
    let renditions = [];
    try {
      renditions = (await resolveTenantVideoProfiles({ accountId, tenantId: job.tenantId })) || [];
    } catch {
      /* optional */
    }
    return vodOutputUrls({
      cdnBase: s3.cdnBase,
      tenantId: job.tenantId,
      guid,
      provider: s3.provider,
      bucket: s3.bucket,
      customerFolder: s3.customerFolder,
      renditions,
    });
  } catch {
    return null;
  }
}

/**
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @returns {Promise<string | null>}
 */
export async function resolveJobMasterOutputUrl(job) {
  if (!job?.tenantId) return null;

  const spec = job.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec : null;
  const fromSpec =
    spec && typeof spec.__masterUrl === "string" ? spec.__masterUrl.trim() : "";
  if (fromSpec && /^https?:\/\//i.test(fromSpec)) return fromSpec;

  const urls = await resolveJobVodUrls(job);
  return urls?.masterUrl || null;
}

/**
 * Pick the highest-resolution entry from a rendition MP4 list (best quality for syndication).
 * Falls back to the first entry when resolutions are unparseable.
 *
 * @param {Array<{ resolution?: string, url: string }>} entries
 * @returns {{ resolution?: string, url: string } | null}
 */
function pickBestMp4Entry(entries) {
  let best = null;
  let bestArea = -1;
  for (const entry of entries) {
    const match = String(entry?.resolution || "").match(/(\d+)\s*[xX]\s*(\d+)/);
    const area = match ? Number(match[1]) * Number(match[2]) : 0;
    if (area > bestArea) {
      bestArea = area;
      best = entry;
    }
  }
  return best || entries[0] || null;
}

/**
 * Resolve a public MP4 URL usable by social syndication upload APIs.
 *
 * The job's `outputUrl` is the HLS master (`.m3u8`), which YouTube/X/Facebook/Instagram/TikTok
 * cannot ingest. The immergo editorial pipeline encodes a dedicated syndication MP4 and uploads it
 * public-read to `{prefix}/{tenant}/{vodKey}/{vodKey}.mp4`, reporting its public URL to the CMS in
 * `outputUrls` (the HLS-master override only replaces `outputUrl`, never the `outputUrls` array).
 *
 * Source priority:
 *   1. The encoder-reported public MP4 in `job.outputUrls` / `job.outputUrl` (the real, public file).
 *   2. Encoder-reported assets persisted on `editorSpec.__outputAssets` (kind === "mp4").
 *   3. The Insight VOD content[] MP4 (public URL the app serves).
 *   4. The per-rendition MP4 layout, derived as a last resort.
 *
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @returns {Promise<string | null>}
 */
export async function resolveJobSyndicationMp4Url(job) {
  if (!job?.tenantId) return null;
  const spec = job.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec : null;

  const isHttpMp4 = (value) =>
    typeof value === "string" &&
    /^https?:\/\//i.test(value.trim()) &&
    /\.mp4(?:\?|$)/i.test(value.trim());

  // 1) The encoder-reported public syndication MP4. The editorial pipeline reports
  //    `outputUrls: [masterUrl, mp4Url, posterUrl, ...hlsUrls]`; the CMS keeps that array even when
  //    it overrides `outputUrl` with the HLS master. This is the only publicly-readable MP4.
  const reportedMp4 = (Array.isArray(job.outputUrls) ? job.outputUrls : []).find(isHttpMp4);
  if (reportedMp4) return reportedMp4.trim();
  if (isHttpMp4(job.outputUrl)) return job.outputUrl.trim();

  // 2) Encoder-reported output assets (the generated "content"), filtered by MP4.
  const assets = Array.isArray(spec?.__outputAssets) ? spec.__outputAssets : [];
  const assetMp4 = assets.find(
    (a) => a && a.kind === "mp4" && typeof a.url === "string" && /^https?:\/\//i.test(a.url.trim()),
  );
  if (assetMp4) return assetMp4.url.trim();

  // 3) Insight VOD content[] MP4 (public URL the app serves).
  const guid = resolveJobVodGuid(job);
  if (guid) {
    const contentMp4 = await fetchInsightVodBestMp4Url({ tenantId: job.tenantId, vodGuid: guid });
    if (contentMp4) return contentMp4;
  }

  // 4) Derive from the per-rendition MP4 layout (byte-for-byte the same as content[] mp4 URLs).
  const urls = await resolveJobVodUrls(job);
  const mp4Entries = Array.isArray(urls?.mp4Entries) ? urls.mp4Entries : [];
  if (mp4Entries.length) {
    const best = pickBestMp4Entry(mp4Entries);
    if (best?.url && /^https?:\/\//i.test(best.url.trim())) return best.url.trim();
  }

  return null;
}
