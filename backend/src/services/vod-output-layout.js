/**
 * Legacy-compatible S3 output layout for Live2VOD editorial jobs, SHARED with the
 * immergo encoder agent (immergo-vod-encoder-agent/.../editorial/s3-upload.mjs).
 *
 * Matches insight-api createClip URLs:
 *   {cdnBase}/{customerFolder}/transcoded/{guid}/...
 *
 * Legacy agent uploads with output=`{customerFolder}/transcoded` + origin_id=guid,
 * yielding the same object keys as vodBaseKey() below.
 */

/** Legacy folder segment (insight-api always uses "transcoded"). */
export const VOD_TRANSCODED_FOLDER = (
  process.env.VOD_TRANSCODED_FOLDER || "transcoded"
).replace(/^\/+|\/+$/g, "");

/** Match the encoder's sanitizeTenantSegment so keys line up byte-for-byte. */
export function sanitizeTenantSegment(tenantId) {
  return String(tenantId).replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Customer folder for CDN/S3 paths (defaults to tenant id; may differ when
 * storage provider sets useProviderBucket).
 * @param {string} tenantId
 * @param {string} [customerFolder]
 */
export function resolveCustomerFolder(tenantId, customerFolder) {
  const raw = (customerFolder || tenantId || "").trim();
  return raw ? sanitizeTenantSegment(raw) : sanitizeTenantSegment(tenantId);
}

/**
 * Relative S3 object-key base (no CDN host): `{customerFolder}/transcoded/{guid}`.
 * @param {string} tenantId
 * @param {string} guid
 * @param {string} [customerFolder]
 */
export function vodBaseKey(tenantId, guid, customerFolder) {
  const folder = resolveCustomerFolder(tenantId, customerFolder);
  return `${folder}/${VOD_TRANSCODED_FOLDER}/${guid}`;
}

/**
 * Legacy agent `output` field: `{customerFolder}/transcoded` (guid appended at upload).
 * @param {string} tenantId
 * @param {string} [customerFolder]
 */
export function legacyOutputPrefix(tenantId, customerFolder) {
  return `${resolveCustomerFolder(tenantId, customerFolder)}/${VOD_TRANSCODED_FOLDER}`;
}

/**
 * Public playback URLs for a job, built from the tenant CDN base + legacy layout.
 * @param {object} opts
 * @param {string} opts.cdnBase
 * @param {string} opts.tenantId
 * @param {string} opts.guid
 * @param {string} [opts.customerFolder]
 * @param {Array<{ res?: string, resolution?: string, notGenerateMp4?: boolean }>} [opts.renditions]
 */
export function vodOutputUrls({ cdnBase, tenantId, guid, customerFolder, renditions = [] }) {
  const cdn = String(cdnBase || "").replace(/\/+$/, "");
  const base = `${cdn}/${vodBaseKey(tenantId, guid, customerFolder)}`;
  const mp4Entries = renditions
    .filter((r) => !r?.notGenerateMp4)
    .map((r) => {
      const res = r.res || r.resolution || "1280x720";
      return { resolution: res, url: `${base}/${res}_${guid}.mp4` };
    });
  return {
    base,
    masterUrl: `${base}/hls/master.m3u8`,
    posterUrl: `${base}/poster.jpg`,
    mp4Entries,
  };
}
