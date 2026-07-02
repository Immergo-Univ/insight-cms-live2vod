/**
 * Upload objects to a tenant's primary S3 storage (resolved from insight-api),
 * using the same transcoded key layout as the immergo encoder agent.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { vodTranscodedObjectKey } from "./vod-output-layout.js";

/** @type {Map<string, S3Client>} */
const clientCache = new Map();

function clientCacheKey(s3) {
  return `${s3.bucket}|${s3.hostname}|${s3.key}|${s3.provider}`;
}

/**
 * Normalize a storage endpoint to a full URL with scheme. insight-api stores hostnames
 * without a protocol (e.g. "s3.wasabisys.com"), but the AWS SDK v3 requires a valid URL
 * (aws-sdk v2, used by the encoder agent, is more lenient — hence it works there).
 * @param {string} raw
 * @returns {string} full URL, or "" when no host given
 */
function normalizeEndpointUrl(raw) {
  const h = String(raw || "").trim();
  if (!h) return "";
  if (/^https?:\/\//i.test(h)) return h.replace(/\/+$/, "");
  return `https://${h.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

/**
 * Best-effort region from a Wasabi/S3 endpoint host (e.g. s3.us-east-2.wasabisys.com → us-east-2).
 * Region participates in SigV4, so a wrong region can break uploads on some providers.
 * @param {string} endpointUrl
 * @returns {string | null}
 */
function regionFromEndpoint(endpointUrl) {
  const m = String(endpointUrl || "").match(
    /(?:^|\.)([a-z]{2}-[a-z]+-\d)\.(?:wasabisys|amazonaws|digitaloceanspaces)\.com/i,
  );
  return m ? m[1].toLowerCase() : null;
}

/**
 * @param {object} s3 resolved tenant S3 from tenant-storage.service
 * @returns {S3Client}
 */
function getTenantS3Client(s3) {
  const cacheKey = clientCacheKey(s3);
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const endpoint = normalizeEndpointUrl(s3.hostname);
  const isDigitalOcean =
    s3.provider === "digitalocean" || /digitaloceanspaces\.com/i.test(endpoint);
  const forcePathStyle =
    s3.pathStyle === true || (s3.pathStyle !== false && isDigitalOcean);

  const region =
    (process.env.S3_SIGNING_REGION || "").trim() ||
    regionFromEndpoint(endpoint) ||
    "us-east-1";

  const client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    credentials: {
      accessKeyId: s3.key,
      secretAccessKey: s3.secret,
    },
    forcePathStyle,
  });
  clientCache.set(cacheKey, client);
  return client;
}

/**
 * Upload a file under `{output}/{guid}/{fileName}` on the tenant bucket.
 *
 * @param {object} opts
 * @param {object} opts.s3 resolved tenant S3
 * @param {string} opts.tenantId
 * @param {string} opts.guid VOD guid (= originId)
 * @param {string} opts.fileName e.g. poster.jpg
 * @param {Buffer} opts.body
 * @param {string} opts.contentType
 * @returns {Promise<{ key: string }>}
 */
export async function putTenantTranscodedObject({
  s3,
  tenantId,
  guid,
  fileName,
  body,
  contentType,
}) {
  if (!s3?.bucket || !s3?.key || !s3?.secret) {
    throw new Error("putTenantTranscodedObject: missing tenant S3 credentials");
  }
  const key = vodTranscodedObjectKey({
    tenantId,
    guid,
    fileName,
    provider: s3.provider,
    bucket: s3.bucket,
    customerFolder: s3.customerFolder,
  });
  const client = getTenantS3Client(s3);
  await client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { key };
}
