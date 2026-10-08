/**
 * Resolve the public HLS master URL for a completed VOD encode job.
 * Uses the same CDN layout as insight-vod / vod-output-layout (not the S3 key prefix).
 */

import { resolveTenant } from "./auth.service.js";
import { resolveTenantS3 } from "./tenant-storage.service.js";
import { resolveTenantVideoProfiles } from "./video-profiles.service.js";
import { vodOutputUrls } from "./vod-output-layout.js";
import { resolveJobVodGuid } from "./vod-jobs.store.js";

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
 * cannot ingest. Immergo (and encoder-lite) always generate at least one MP4 rendition, so we
 * derive it from the generated "content". Source priority:
 *   1. Encoder-reported assets persisted on `editorSpec.__outputAssets` (kind === "mp4").
 *   2. The per-rendition MP4 layout (same URLs the Insight VOD `content[]` mp4 entries use).
 *   3. The job `outputUrl` itself, only when it already points to an `.mp4`.
 *
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @returns {Promise<string | null>}
 */
export async function resolveJobSyndicationMp4Url(job) {
  if (!job?.tenantId) return null;
  const spec = job.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec : null;

  // 1) Encoder-reported output assets (the generated "content"), filtered by MP4.
  const assets = Array.isArray(spec?.__outputAssets) ? spec.__outputAssets : [];
  const assetMp4 = assets.find(
    (a) => a && a.kind === "mp4" && typeof a.url === "string" && /^https?:\/\//i.test(a.url.trim()),
  );
  if (assetMp4) return assetMp4.url.trim();

  // 2) Derive from the per-rendition MP4 layout (byte-for-byte the same as content[] mp4 URLs).
  const urls = await resolveJobVodUrls(job);
  const mp4Entries = Array.isArray(urls?.mp4Entries) ? urls.mp4Entries : [];
  if (mp4Entries.length) {
    const best = pickBestMp4Entry(mp4Entries);
    if (best?.url && /^https?:\/\//i.test(best.url.trim())) return best.url.trim();
  }

  // 3) Last resort: the job output URL, only when it is already an MP4.
  const outputUrl = typeof job.outputUrl === "string" ? job.outputUrl.trim() : "";
  if (/^https?:\/\//i.test(outputUrl) && /\.mp4(?:\?|$)/i.test(outputUrl)) return outputUrl;

  return null;
}
