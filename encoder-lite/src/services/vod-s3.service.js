/**
 * VOD MP4 upload + poster reads (same key layout as backend).
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
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
 * Bucket-relative base key for a job's HLS tree.
 * @param {string} tenantId
 * @param {string} jobId
 * @param {string} [clipTag] e.g. "clip1" for multi-clip jobs; omitted for single-clip.
 * @returns {string}
 */
export function vodHlsBaseKey(tenantId, jobId, clipTag) {
  const seg = sanitizeTenantSegment(tenantId);
  const j = String(jobId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const tag = clipTag ? `/${String(clipTag).replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
  return objectKeySuffix(`generated-vods/${seg}/${j}${tag}/hls`);
}

/**
 * @param {string} fileName
 * @returns {string}
 */
function hlsContentType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (lower.endsWith(".m4s")) return "video/mp4";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".ts")) return "video/MP2T";
  return "application/octet-stream";
}

/**
 * Recursively collect files (absolute paths + posix-relative keys) under `dir`.
 * @param {string} dir
 * @param {string} [rel]
 * @returns {Promise<Array<{ abs: string, rel: string }>>}
 */
async function walkFiles(dir, rel = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  /** @type {Array<{ abs: string, rel: string }>} */
  const out = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(abs, childRel)));
    } else if (entry.isFile()) {
      out.push({ abs, rel: childRel });
    }
  }
  return out;
}

/**
 * Upload a local HLS directory tree (master + variant playlists + segments) with public-read.
 *
 * @param {string} tenantId
 * @param {string} jobId
 * @param {string | undefined} clipTag
 * @param {string} localDir Directory containing master.m3u8 and stream_N subfolders.
 * @param {string} [masterFileName]
 * @returns {Promise<{ baseKey: string, masterKey: string, masterUrl: string | null }>}
 */
export async function putVodHlsDir(tenantId, jobId, clipTag, localDir, masterFileName = "master.m3u8") {
  const c = getClient();
  if (!c) throw new Error("S3 not configured (need S3_* credentials, bucket, endpoint)");
  const baseKey = vodHlsBaseKey(tenantId, jobId, clipTag);
  const files = await walkFiles(localDir);
  for (const f of files) {
    const key = `${baseKey}/${f.rel}`;
    await c.send(
      new PutObjectCommand({
        Bucket: config.s3Logos.bucket,
        Key: key,
        Body: createReadStream(f.abs),
        ContentType: hlsContentType(f.rel),
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }
  const masterKey = `${baseKey}/${masterFileName}`;
  return { baseKey, masterKey, masterUrl: publicUrlForVodKey(masterKey) };
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
