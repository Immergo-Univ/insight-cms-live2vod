/**
 * Per-channel snapshot on disk under backend/data/channels/<channelId>.json
 * (precalculated ads + live stream probe fields).
 */

import fs from "fs/promises";
import path from "path";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import {
  deleteChannelAdsBackupObject,
  isS3LogosEnabled,
  putChannelAdsBackupDocument,
} from "./s3-logos.service.js";

const __channelsDir = config.channelsDataDir;
const __indexPath = path.join(__channelsDir, "_index.json");

function safeChannelFileBase(channelId) {
  return String(channelId).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function channelFilePath(channelId) {
  return path.join(__channelsDir, `${safeChannelFileBase(channelId)}.json`);
}

/** Absolute path to data/channels/<safeId>.json (for S3 restore / tooling). */
export function getChannelSnapshotPath(channelId) {
  return channelFilePath(channelId);
}

function resolveBaseUrl(hlsStream) {
  const url = new URL(hlsStream);
  return `${url.origin}${url.pathname}`;
}

function isJsonSyntaxError(e) {
  return e instanceof SyntaxError || (typeof e?.name === "string" && e.name === "SyntaxError");
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    if (isJsonSyntaxError(e)) {
      console.warn(`[channel-ads-disk] Invalid JSON ignored (will rebuild on merge): ${filePath}`);
      return null;
    }
    throw e;
  }
}

/**
 * Atomic write with a unique temp name so concurrent merges (many logo-live channels) do not
 * clobber the same ".tmp" and break rename with ENOENT.
 */
async function writeJsonAtomic(filePath, obj) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
    await fs.rename(tmp, filePath);
  } catch (e) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** Serialize HLS → channelId index updates (read-modify-write) across parallel channel merges. */
let indexWriteChain = Promise.resolve();

function withIndexLock(fn) {
  const next = indexWriteChain.then(() => fn());
  indexWriteChain = next.catch(() => {});
  return next;
}

async function loadIndex() {
  const data = await readJsonIfExists(__indexPath);
  if (!data || typeof data !== "object") return { byBaseUrl: {} };
  const bb = data.byBaseUrl;
  if (!bb || typeof bb !== "object" || Array.isArray(bb)) return { ...data, byBaseUrl: {} };
  return data;
}

async function saveIndex(byBaseUrl) {
  await writeJsonAtomic(__indexPath, { version: 1, updatedAt: new Date().toISOString(), byBaseUrl });
}

async function persistSnapshotAndIndex(channelId, next) {
  await writeJsonAtomic(channelFilePath(channelId), next);
  if (typeof next.hlsBaseUrl === "string" && next.hlsBaseUrl) {
    await withIndexLock(async () => {
      const index = await loadIndex();
      index.byBaseUrl[next.hlsBaseUrl] = channelId;
      await saveIndex(index.byBaseUrl);
    });
  }
}

/**
 * Replace on-disk snapshot from a full document (e.g. S3 backup restore). Preserves doc.updatedAt when present.
 * @param {Record<string, unknown>} doc
 */
export async function writeChannelSnapshotDocument(doc) {
  if (!doc || typeof doc !== "object") return;
  const channelId = String(doc.channelId ?? "").trim();
  if (!channelId) {
    console.warn("[channel-ads-disk] writeChannelSnapshotDocument: skipped — missing channelId");
    return;
  }
  const next = { version: doc.version ?? 1, ...doc, channelId };
  await persistSnapshotAndIndex(channelId, next);
}

/**
 * @param {string} channelId
 * @returns {Promise<object | null>}
 */
export async function readChannelSnapshotById(channelId) {
  return readJsonIfExists(channelFilePath(channelId));
}

/**
 * Shallow merge into the channel snapshot (creates a minimal doc if missing).
 * @param {string} channelId
 * @param {Record<string, unknown>} patch
 */
export async function mergeChannelSnapshotFields(channelId, patch) {
  const cur = await readChannelSnapshotById(channelId);
  const base =
    cur && typeof cur === "object"
      ? cur
      : {
          version: 1,
          channelId,
          tenantId: patch.tenantId ?? "",
          hlsBaseUrl: typeof patch.hlsBaseUrl === "string" ? patch.hlsBaseUrl : "",
          ads: [],
        };
  const next = {
    ...base,
    ...patch,
    channelId: base.channelId || channelId,
    updatedAt: new Date().toISOString(),
  };
  await persistSnapshotAndIndex(channelId, next);

  if (isS3LogosEnabled()) {
    void putChannelAdsBackupDocument(channelId, next).catch((e) =>
      console.warn(`[channel-ads-s3] upload failed ${channelId}:`, e.message),
    );
  }
}

/**
 * @param {string} hlsStream full or base URL with path
 * @returns {Promise<object | null>}
 */
export async function readChannelSnapshotByHls(hlsStream) {
  const baseUrl = resolveBaseUrl(hlsStream);
  const index = await loadIndex();
  const channelId = index.byBaseUrl[baseUrl];
  if (!channelId) return null;
  return readJsonIfExists(channelFilePath(channelId));
}

/**
 * Remove local channel snapshot JSON and HLS index entries for this channel (ads + live probe fields).
 * @param {string} channelId
 * @returns {Promise<{ localExisted: boolean }>}
 */
export async function clearChannelAdsSnapshot(channelId) {
  const cid = String(channelId);
  const fp = getChannelSnapshotPath(cid);
  let localExisted = false;
  try {
    await fs.access(fp);
    localExisted = true;
  } catch {
    /* no file */
  }

  await withIndexLock(async () => {
    const data = await loadIndex();
    const bb = { ...(data.byBaseUrl || {}) };
    for (const [url, id] of Object.entries(bb)) {
      if (String(id) === cid) delete bb[url];
    }
    await saveIndex(bb);
  });

  try {
    await fs.unlink(fp);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  return { localExisted };
}

/**
 * Remove ALL channel snapshots (ads + live probe data) belonging to a tenant, from local disk,
 * the HLS index and the S3 backup. Used when a tenant is deleted so no channel keeps lingering
 * ad-recognition data. Only touches the insight-cms-live2vod data store.
 *
 * @param {string} tenantId
 * @returns {Promise<{ channels: number }>}
 */
export async function clearTenantChannelSnapshots(tenantId) {
  const tid = String(tenantId || "").trim();
  if (!tid) return { channels: 0 };

  let entries = [];
  try {
    entries = await fs.readdir(__channelsDir);
  } catch {
    return { channels: 0 };
  }

  const channelIds = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || name === "_index.json") continue;
    const doc = await readJsonIfExists(path.join(__channelsDir, name));
    if (doc && typeof doc === "object" && String(doc.tenantId || "") === tid && doc.channelId) {
      channelIds.push(String(doc.channelId));
    }
  }

  for (const channelId of channelIds) {
    await clearChannelAdsSnapshot(channelId);
    if (isS3LogosEnabled()) {
      try {
        await deleteChannelAdsBackupObject(channelId);
      } catch {
        /* best effort S3 cleanup */
      }
    }
  }

  return { channels: channelIds.length };
}

export { resolveBaseUrl as resolveHlsBaseUrl };
