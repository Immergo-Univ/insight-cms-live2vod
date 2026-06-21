/**
 * Canonical S3 output layout for Live2VOD editorial jobs, SHARED with the
 * immergo encoder agent (immergo-vod-encoder-agent/.../editorial/s3-upload.mjs).
 *
 * The BFF uses this to pre-populate the VOD `content[]` URLs in insight-api
 * Mongo BEFORE the encode runs (legacy behaviour), and the agent uploads to the
 * exact same keys. `guid` (the Mongo VOD guid) is the shared key.
 *
 *   base   = {cdnBase}/{prefix}/{tenant}/{guid}
 *   master = {base}/hls/master.m3u8
 *   mp4    = {base}/{guid}.mp4
 *   poster = {base}/poster.jpg
 */

/** Object-key prefix (no leading/trailing slash). Must match EDITORIAL_S3_PREFIX on the encoder. */
export const VOD_OUTPUT_PREFIX = (
  process.env.VOD_OUTPUT_PREFIX ||
  process.env.EDITORIAL_S3_PREFIX ||
  "generated-vods"
).replace(/^\/+|\/+$/g, "");

/** Match the encoder's sanitizeTenantSegment so keys line up byte-for-byte. */
export function sanitizeTenantSegment(tenantId) {
  return String(tenantId).replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Relative object-key base (no CDN host): `{prefix}/{tenant}/{guid}`. */
export function vodBaseKey(tenantId, guid) {
  return `${VOD_OUTPUT_PREFIX}/${sanitizeTenantSegment(tenantId)}/${guid}`;
}

/**
 * Public playback URLs for a job, built from the tenant CDN base + the canonical layout.
 * @param {object} opts
 * @param {string} opts.cdnBase
 * @param {string} opts.tenantId
 * @param {string} opts.guid
 */
export function vodOutputUrls({ cdnBase, tenantId, guid }) {
  const cdn = String(cdnBase || "").replace(/\/+$/, "");
  const base = `${cdn}/${vodBaseKey(tenantId, guid)}`;
  return {
    base,
    masterUrl: `${base}/hls/master.m3u8`,
    mp4Url: `${base}/${guid}.mp4`,
    posterUrl: `${base}/poster.jpg`,
  };
}
