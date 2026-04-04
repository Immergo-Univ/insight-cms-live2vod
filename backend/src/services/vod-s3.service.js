/**
 * Tenant-scoped VOD MP4 objects (separate folder per tenant under the shared S3 prefix).
 */

import {
  S3Client,
  PutObjectCommand,
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
  const { endpoint, bucket } = config.s3Logos;
  if (!endpoint || !bucket) return null;
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/${bucket}/${key}`;
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
