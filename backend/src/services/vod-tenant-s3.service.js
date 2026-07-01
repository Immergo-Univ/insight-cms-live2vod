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
 * @param {object} s3 resolved tenant S3 from tenant-storage.service
 * @returns {S3Client}
 */
function getTenantS3Client(s3) {
  const cacheKey = clientCacheKey(s3);
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const endpoint = String(s3.hostname || "").trim();
  const isDigitalOcean =
    s3.provider === "digitalocean" || /digitaloceanspaces\.com/i.test(endpoint);
  const forcePathStyle =
    s3.pathStyle === true || (s3.pathStyle !== false && isDigitalOcean);

  const client = new S3Client({
    region: (process.env.S3_SIGNING_REGION || "us-east-1").trim(),
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
