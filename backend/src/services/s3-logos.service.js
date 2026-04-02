/**
 * S3-compatible storage for channel logo files and per-channel JSON manifests (DO Spaces, etc.).
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
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

export function isS3LogosEnabled() {
  return Boolean(getClient());
}

/** One-line diagnostic at server start (no secrets). */
export function logS3LogosStartup() {
  const s = config.s3Logos;
  if (!s.enabled) {
    const hasAny =
      s.accessKeyId || s.secretAccessKey || s.bucket || s.endpoint;
    if (hasAny) {
      console.warn(
        "[s3-logos] Incomplete S3 env (uploads use disk only). Need all of: key, secret, S3_BUCKET_NAME, S3_ENDPOINT. Aliases: AWS_* or SPACES_KEY / SPACES_SECRET.",
      );
    } else {
      console.log("[s3-logos] Not configured (disk-only uploads). Set S3_* credentials + endpoint + bucket to enable.");
    }
    return;
  }
  console.log(
    `[s3-logos] Enabled — bucket=${s.bucket} endpoint=${s.endpoint} signingRegion=${s.region} forcePathStyle=${s.forcePathStyle} prefix=${s.prefix || "(root)"}`,
  );
}

function objectKeySuffix(suffix) {
  const p = config.s3Logos.prefix;
  const s = String(suffix).replace(/^\/+/, "");
  return p ? `${p}/${s}` : s;
}

/**
 * @param {string} storedRelative segment/filename
 */
export function logoObjectKey(storedRelative) {
  const rel = String(storedRelative).replace(/^\/+/, "");
  return objectKeySuffix(rel);
}

/**
 * @param {string} channelSegment safe channel folder segment
 */
export function manifestObjectKey(channelSegment) {
  const seg = String(channelSegment).replace(/[^a-zA-Z0-9_-]/g, "_");
  return objectKeySuffix(`manifests/${seg}.json`);
}

/**
 * Per-channel ads/timeline snapshot backup (same filename convention as data/channels/*.json).
 * @param {string} channelId
 */
export function channelAdsBackupObjectKey(channelId) {
  const seg = String(channelId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return objectKeySuffix(`channel-ads/${seg}.json`);
}

function channelAdsBackupListPrefix() {
  const p = config.s3Logos.prefix;
  return p ? `${p}/channel-ads/` : `channel-ads/`;
}

/**
 * @param {Buffer | Uint8Array} body
 * @param {string} contentType
 */
export async function putLogoObject(storedRelative, body, contentType) {
  const c = getClient();
  if (!c) throw new Error("S3 logos not configured");
  const key = logoObjectKey(storedRelative);
  await c.send(
    new PutObjectCommand({
      Bucket: config.s3Logos.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    }),
  );
  return key;
}

/**
 * @param {string} channelSegment
 * @param {object} doc JSON-serializable channel settings document
 */
export async function putManifestDocument(channelSegment, doc) {
  const c = getClient();
  if (!c) throw new Error("S3 logos not configured");
  const key = manifestObjectKey(channelSegment);
  const body = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await c.send(
    new PutObjectCommand({
      Bucket: config.s3Logos.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json; charset=utf-8",
    }),
  );
  return key;
}

/**
 * @returns {Promise<string | null>} raw JSON or null if missing
 */
export async function getManifestJsonString(channelSegment) {
  const c = getClient();
  if (!c) return null;
  const key = manifestObjectKey(channelSegment);
  try {
    const out = await c.send(
      new GetObjectCommand({
        Bucket: config.s3Logos.bucket,
        Key: key,
      }),
    );
    const buf = await streamToBuffer(out.Body);
    return buf.toString("utf8");
  } catch (e) {
    if (e && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) return null;
    throw e;
  }
}

/**
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

export async function deleteLogoObject(storedRelative) {
  const c = getClient();
  if (!c) throw new Error("S3 logos not configured");
  const key = logoObjectKey(storedRelative);
  try {
    await c.send(
      new DeleteObjectCommand({
        Bucket: config.s3Logos.bucket,
        Key: key,
      }),
    );
  } catch (e) {
    if (e && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) return;
    throw e;
  }
}

/**
 * @returns {Promise<string[]>} manifest object keys (full S3 keys)
 */
export async function listManifestObjectKeys() {
  const c = getClient();
  if (!c) return [];
  const prefix = config.s3Logos.prefix ? `${config.s3Logos.prefix}/manifests/` : `manifests/`;
  const keys = [];
  let ContinuationToken;
  do {
    const out = await c.send(
      new ListObjectsV2Command({
        Bucket: config.s3Logos.bucket,
        Prefix: prefix,
        ContinuationToken,
      }),
    );
    for (const item of out.Contents || []) {
      if (item.Key && item.Key.endsWith(".json")) keys.push(item.Key);
    }
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

/**
 * @returns {Promise<Array<{ key: string, lastModified: Date }>>}
 */
export async function listChannelAdsBackupObjects() {
  const c = getClient();
  if (!c) return [];
  const prefix = channelAdsBackupListPrefix();
  const outList = [];
  let ContinuationToken;
  do {
    const out = await c.send(
      new ListObjectsV2Command({
        Bucket: config.s3Logos.bucket,
        Prefix: prefix,
        ContinuationToken,
      }),
    );
    for (const item of out.Contents || []) {
      if (item.Key && item.Key.endsWith(".json") && item.LastModified) {
        outList.push({ key: item.Key, lastModified: item.LastModified });
      }
    }
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return outList;
}

/**
 * @param {string} key full S3 object key
 * @returns {Promise<string | null>}
 */
export async function getS3ObjectUtf8(key) {
  const cl = getClient();
  if (!cl) return null;
  try {
    const out = await cl.send(
      new GetObjectCommand({
        Bucket: config.s3Logos.bucket,
        Key: key,
      }),
    );
    const buf = await streamToBuffer(out.Body);
    return buf.toString("utf8");
  } catch (e) {
    if (e && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) return null;
    throw e;
  }
}

/**
 * @param {string} channelId
 * @param {object} doc JSON-serializable channel snapshot (ads, live fields, etc.)
 */
export async function putChannelAdsBackupDocument(channelId, doc) {
  const cl = getClient();
  if (!cl) return;
  const key = channelAdsBackupObjectKey(channelId);
  const body = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await cl.send(
    new PutObjectCommand({
      Bucket: config.s3Logos.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json; charset=utf-8",
    }),
  );
}

/**
 * Remove channel ads backup object if present (no-op when S3 disabled).
 * @param {string} channelId
 */
export async function deleteChannelAdsBackupObject(channelId) {
  const cl = getClient();
  if (!cl) return { ok: true, skipped: true };
  const key = channelAdsBackupObjectKey(channelId);
  try {
    await cl.send(
      new DeleteObjectCommand({
        Bucket: config.s3Logos.bucket,
        Key: key,
      }),
    );
    return { ok: true, deleted: true };
  } catch (e) {
    if (e && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) return { ok: true, deleted: false };
    throw e;
  }
}

/**
 * @param {import("stream").Readable | AsyncIterable<Uint8Array> | undefined | null} stream
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
