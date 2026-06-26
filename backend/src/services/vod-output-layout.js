/**
 * Legacy-compatible S3 output layout for Live2VOD jobs, SHARED with the immergo encoder.
 *
 * IMPORTANT — two distinct concepts:
 *   - urlFolder: the first path segment of the PUBLIC URL after the CDN host.
 *   - keyPrefix: the S3 object KEY prefix the encoder uploads under (the agent `output`).
 *
 * DigitalOcean Spaces is addressed PATH-STYLE: the public URL is
 *   {cdnBase}/{bucket}/{key}
 * so the first URL segment IS the bucket and the KEY must NOT repeat it:
 *   url = {cdnBase}/{bucket}/transcoded/{guid}/...   key = transcoded/{guid}/...
 *
 * Virtual-hosted providers (s3 / wasabi) put the bucket in the HOST, so the tenant folder
 * lives in BOTH the URL and the key:
 *   url = {cdnBase}/{tenant}/transcoded/{guid}/...   key = {tenant}/transcoded/{guid}/...
 *
 * insight-api createClip URLs are matched: {cdnBase}/{folder}/transcoded/{guid}/...
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
 * Resolve the URL folder (public path segment) and the S3 key prefix (encoder `output`),
 * REPLICATING insight-api's getTranscodingProvider so the layout matches the working legacy
 * clips exactly:
 *
 *   - urlFolder  = customerFolder (tenant code, or folderOrBucket when useProviderBucket).
 *                  Public URL = {cdnBase}/{urlFolder}/transcoded/{guid}/...
 *   - keyPrefix  = the bucket is prepended to the key ONLY for DigitalOcean; for every other
 *                  provider (wasabi / s3 / netstorage) the key is just "transcoded".
 *                  (insight-api: `${provider=='digitalocean' ? folderOrBucket+'/' : ''}transcoded`)
 *
 * This infra serves objects path-style ({cdn}/{bucket}/{key}, bucket = folderOrBucket =
 * customerFolder), so the key must NOT repeat the tenant folder.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} [opts.provider] storage provider (digitalocean | wasabi | s3 | ...)
 * @param {string} [opts.bucket] storage bucket (folderOrBucket)
 * @param {string} [opts.customerFolder] tenant folder for the public URL
 * @returns {{ urlFolder: string, keyPrefix: string }}
 */
export function vodLayout({ tenantId, provider, bucket, customerFolder }) {
  const urlFolder = sanitizeTenantSegment(customerFolder || tenantId);
  const keyPrefix =
    provider === "digitalocean"
      ? `${sanitizeTenantSegment(bucket || customerFolder || tenantId)}/${VOD_TRANSCODED_FOLDER}`
      : VOD_TRANSCODED_FOLDER;
  return { urlFolder, keyPrefix };
}

/**
 * Encoder `output` (S3 key prefix the agent uploads under).
 * @param {object} s3 resolved tenant S3 ({ provider, bucket, customerFolder })
 * @param {string} tenantId
 */
export function encoderOutputPrefix(s3, tenantId) {
  return vodLayout({
    tenantId,
    provider: s3?.provider,
    bucket: s3?.bucket,
    customerFolder: s3?.customerFolder,
  }).keyPrefix;
}

/**
 * Public playback URLs for a job. The base must line up byte-for-byte with where the encoder
 * uploads (resolved via vodLayout): {cdnBase}/{urlFolder}/transcoded/{guid}/...
 *
 * @param {object} opts
 * @param {string} opts.cdnBase
 * @param {string} opts.tenantId
 * @param {string} opts.guid
 * @param {string} [opts.provider]
 * @param {string} [opts.bucket]
 * @param {string} [opts.customerFolder]
 * @param {Array<{ res?: string, resolution?: string, notGenerateMp4?: boolean }>} [opts.renditions]
 */
export function vodOutputUrls({
  cdnBase,
  tenantId,
  guid,
  provider,
  bucket,
  customerFolder,
  renditions = [],
}) {
  const { urlFolder } = vodLayout({ tenantId, provider, bucket, customerFolder });
  const cdn = String(cdnBase || "").replace(/\/+$/, "");
  const base = `${cdn}/${urlFolder}/${VOD_TRANSCODED_FOLDER}/${guid}`;
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
