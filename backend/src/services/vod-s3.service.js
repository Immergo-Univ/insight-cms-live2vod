/**
 * Tenant-scoped VOD MP4 objects (separate folder per tenant under the shared S3 prefix).
 */

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
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

export function sanitizeTenantSegment(tenantId) {
  return String(tenantId).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function objectKeySuffix(suffix) {
  const p = config.s3Logos.prefix;
  const s = String(suffix).replace(/^\/+/, "");
  return p ? `${p}/${s}` : s;
}

/**
 * @param {string} tenantId
 * @param {string} fileName e.g. jobId.mp4
 */
export function vodObjectKey(tenantId, fileName) {
  const seg = sanitizeTenantSegment(tenantId);
  const safeName = String(fileName).replace(/[^a-zA-Z0-9_.-]/g, "_");
  return objectKeySuffix(`generated-vods/${seg}/${safeName}`);
}

/**
 * Public URL for a key (same convention as other S3 helpers in this project).
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
 * Editor-uploaded clip widget image (public CDN key; not under channel-logos prefix).
 *
 * @param {string} channelSegment
 * @param {string} imageId uuid
 * @param {string} extWithDot e.g. .png
 */
export function editorWidgetImageObjectKey(channelSegment, imageId, extWithDot) {
  const prefix = config.s3Logos.widgetImagesPrefix || "widget-images";
  const seg = sanitizeTenantSegment(channelSegment);
  const safeId = String(imageId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = extWithDot.startsWith(".") ? extWithDot : `.${extWithDot}`;
  return `${prefix}/${seg}/${safeId}${ext}`;
}

/**
 * @param {object} opts
 * @param {string} opts.channelSegment
 * @param {string} opts.imageId
 * @param {Buffer} opts.buffer
 * @param {string} opts.contentType
 * @param {string} opts.extWithDot
 */
export async function putEditorWidgetImagePublic(opts) {
  const { channelSegment, imageId, buffer, contentType, extWithDot } = opts;
  const c = getClient();
  if (!c) throw new Error("S3 not configured (need S3_* credentials, bucket, endpoint)");
  const key = editorWidgetImageObjectKey(channelSegment, imageId, extWithDot);
  await c.send(
    new PutObjectCommand({
      Bucket: config.s3Logos.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "image/png",
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { key, publicUrl: publicUrlForVodKey(key) };
}

/**
 * Channel-logo sample crop object key (public; under a dedicated prefix, one folder per channel).
 * @param {string} channelId
 * @param {string} sampleId
 */
export function channelLogoSampleObjectKey(channelId, sampleId) {
  const prefix = (process.env.S3_LOGO_SAMPLES_PREFIX || "channel-logo-samples").replace(
    /^\/+|\/+$/g,
    "",
  );
  const seg = sanitizeTenantSegment(channelId);
  const safeId = String(sampleId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${prefix}/${seg}/${safeId}.jpg`;
}

/**
 * Upload a channel-logo sample crop (JPEG) with public-read ACL, returning key + public URL.
 * The microservice fetches these public URLs as logo templates.
 * @param {string} channelId
 * @param {string} sampleId
 * @param {Buffer} buffer
 */
export async function putChannelLogoSamplePublic(channelId, sampleId, buffer) {
  const c = getClient();
  if (!c) throw new Error("S3 not configured (need S3_* credentials, bucket, endpoint)");
  const key = channelLogoSampleObjectKey(channelId, sampleId);
  await c.send(
    new PutObjectCommand({
      Bucket: config.s3Logos.bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
      ACL: "public-read",
      CacheControl: "public, max-age=86400",
    }),
  );
  return { key, publicUrl: publicUrlForVodKey(key) };
}

/**
 * Delete an S3 object by key (best-effort). Used when an operator removes a logo sample.
 * @param {string} key
 */
export async function deleteS3ObjectByKey(key) {
  const c = getClient();
  if (!c || !key) return false;
  try {
    await c.send(new DeleteObjectCommand({ Bucket: config.s3Logos.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
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
      /** Spaces/S3-compatible: object readable anonymously when bucket allows ACLs */
      ACL: "public-read",
    }),
  );
  return { key, publicUrl: publicUrlForVodKey(key) };
}

/**
 * @param {string} tenantId
 * @returns {Promise<Array<{ key: string, size?: number, lastModified?: Date, publicUrl: string | null }>>}
 */
export async function listTenantVodMp4s(tenantId) {
  const c = getClient();
  if (!c) return [];
  const seg = sanitizeTenantSegment(tenantId);
  const prefix = objectKeySuffix(`generated-vods/${seg}/`);
  const out = [];
  let ContinuationToken;
  do {
    const res = await c.send(
      new ListObjectsV2Command({
        Bucket: config.s3Logos.bucket,
        Prefix: prefix,
        ContinuationToken,
      }),
    );
    for (const item of res.Contents || []) {
      if (!item.Key || !item.Key.toLowerCase().endsWith(".mp4")) continue;
      out.push({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
        publicUrl: publicUrlForVodKey(item.Key),
      });
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  out.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
  return out;
}
