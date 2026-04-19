/**
 * VOD MP4 upload + poster reads (same key layout as backend).
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config.js";

/** @type {S3Client | null} */
let client = null;

function getClient() {
  if (!config.s3Logos.enabled) return null;
  if (!client) {
    const c = config.s3Logos;
    client = new S3Client({
      region: c.region,
      endpoint: c.endpoint || undefined,
      credentials: {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      },
      forcePathStyle: Boolean(c.forcePathStyle),
    });
  }
  return client;
}

export function sanitizeTenantSegment(tenantId) {
  return String(tenantId).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function objectKeySuffix(suffix) {
  const p = config.s3Logos.prefix;
  const s = String(suffix).replace(/^\/+/, "");
  return p ? `${p}/${s}` : s;
}

export function logoObjectKey(storedRelative) {
  const rel = String(storedRelative).replace(/^\/+/, "");
  return objectKeySuffix(rel);
}

/**
 * @param {string} tenantId
 * @param {string} fileName
 */
export function vodObjectKey(tenantId, fileName) {
  const seg = sanitizeTenantSegment(tenantId);
  const safeName = String(fileName).replace(/[^a-zA-Z0-9_.-]/g, "_");
  return objectKeySuffix(`generated-vods/${seg}/${safeName}`);
}

/**
 * @param {string} key
 */
export function publicUrlForVodKey(key) {
  const cdn = (process.env.S3_CDN || "").trim().replace(/\/+$/, "");
  if (cdn) {
    return `${cdn}/${key}`;
  }
  const { endpoint, bucket } = config.s3Logos;
  if (!endpoint || !bucket) return null;
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/${bucket}/${key}`;
}

/**
 * Public CDN keys for widget PNGs assembled during encode (separate from channel-logos prefix).
 *
 * @param {string} tenantId
 * @param {string} jobId
 * @param {string} fileName
 */
export function widgetImageObjectKey(tenantId, jobId, fileName) {
  const seg = sanitizeTenantSegment(tenantId);
  const j = String(jobId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeName = String(fileName).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const prefix = config.widgetImagesPrefix;
  return prefix ? `${prefix}/${seg}/${j}/${safeName}` : `${seg}/${j}/${safeName}`;
}

/**
 * Upload a rendered widget PNG with public-read so CDN URLs work without signing.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.jobId
 * @param {string} opts.fileName
 * @param {Buffer} opts.body
 * @param {string} [opts.contentType]
 * @returns {Promise<{ key: string, publicUrl: string | null } | null>} null if S3 is disabled
 */
export async function putWidgetImagePublic(opts) {
  const { tenantId, jobId, fileName, body, contentType } = opts;
  const c = getClient();
  if (!c) return null;
  const key = widgetImageObjectKey(tenantId, jobId, fileName);
  await c.send(
    new PutObjectCommand({
      Bucket: config.s3Logos.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "image/png",
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { key, publicUrl: publicUrlForVodKey(key) };
}

/**
 * @param {string} tenantId
 * @param {string} fileName
 * @param {import("fs").ReadStream | Buffer} body
 */
export async function putVodMp4(tenantId, fileName, body) {
  const c = getClient();
  if (!c) throw new Error("S3 not configured (need S3_* credentials, bucket, endpoint)");
  const key = vodObjectKey(tenantId, fileName);
  await c.send(
    new PutObjectCommand({
      Bucket: config.s3Logos.bucket,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
      ACL: "public-read",
    }),
  );
  return { key, publicUrl: publicUrlForVodKey(key) };
}

/**
 * @param {import("@aws-sdk/client-s3").GetObjectCommandOutput["Body"]} body
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {string} storedRelative e.g. posters/<uuid>.png
 * @returns {Promise<Buffer | null>}
 */
export async function getLogoBuffer(storedRelative) {
  const c = getClient();
  if (!c) return null;
  const key = logoObjectKey(storedRelative);
  try {
    const out = await c.send(
      new GetObjectCommand({
        Bucket: config.s3Logos.bucket,
        Key: key,
      }),
    );
    return streamToBuffer(out.Body);
  } catch (e) {
    if (e && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) return null;
    throw e;
  }
}

/**
 * Fetch object by full bucket key (e.g. editor widget uploads under `widget-images/...`, not under logos prefix).
 *
 * @param {string} key
 * @returns {Promise<Buffer | null>}
 */
export async function getS3ObjectBufferByRawKey(key) {
  const c = getClient();
  if (!c) return null;
  const k = String(key || "").replace(/^\/+/, "");
  if (!k) return null;
  try {
    const out = await c.send(
      new GetObjectCommand({
        Bucket: config.s3Logos.bucket,
        Key: k,
      }),
    );
    return streamToBuffer(out.Body);
  } catch (e) {
    if (e && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) return null;
    throw e;
  }
}
