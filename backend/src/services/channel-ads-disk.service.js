/**
 * Per-channel processing snapshot on disk under backend/data/channels/<channelId>.json
 * (ads for timeline + optional 10-minute fragments metadata).
 */

import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";

const __channelsDir = path.join(path.dirname(config.logoScan.stateFilePath), "channels");
const __indexPath = path.join(__channelsDir, "_index.json");

function safeChannelFileBase(channelId) {
  return String(channelId).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function channelFilePath(channelId) {
  return path.join(__channelsDir, `${safeChannelFileBase(channelId)}.json`);
}

function resolveBaseUrl(hlsStream) {
  const url = new URL(hlsStream);
  return `${url.origin}${url.pathname}`;
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

async function writeJsonAtomic(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

async function loadIndex() {
  const data = await readJsonIfExists(__indexPath);
  if (!data || typeof data.byBaseUrl !== "object") return { byBaseUrl: {} };
  return data;
}

async function saveIndex(byBaseUrl) {
  await writeJsonAtomic(__indexPath, { version: 1, updatedAt: new Date().toISOString(), byBaseUrl });
}

/**
 * Persist full snapshot after pipeline ingest (scheduler).
 * @param {{
 *   tenantId: string,
 *   channelId: string,
 *   hlsBaseUrl: string,
 *   ads: Array<{ startEpoch: number, endEpoch: number, startProgramDateTime?: string, endProgramDateTime?: string }>,
 *   processedEarliest: number,
 *   processedLatest: number,
 *   fragments?: unknown[],
 * }} payload
 */
export async function saveChannelProcessingSnapshot(payload) {
  const {
    tenantId,
    channelId,
    hlsBaseUrl,
    ads,
    processedEarliest,
    processedLatest,
    fragments,
  } = payload;

  const hasValidRange =
    Array.isArray(ads) &&
    ads.length > 0 &&
    Number.isFinite(processedEarliest) &&
    Number.isFinite(processedLatest) &&
    processedEarliest !== Infinity &&
    processedLatest !== -Infinity;

  const processedRange = hasValidRange
    ? {
        earliestEpoch: processedEarliest,
        latestEpoch: processedLatest,
        earliest: new Date(processedEarliest * 1000).toISOString(),
        latest: new Date(processedLatest * 1000).toISOString(),
      }
    : null;

  const doc = {
    version: 1,
    tenantId,
    channelId,
    hlsBaseUrl,
    updatedAt: new Date().toISOString(),
    ads: ads ?? [],
    processedRange,
    fragments: fragments ?? undefined,
  };

  const filePath = channelFilePath(channelId);
  await writeJsonAtomic(filePath, doc);

  const index = await loadIndex();
  index.byBaseUrl[hlsBaseUrl] = channelId;
  await saveIndex(index.byBaseUrl);

  console.log(`[channel-ads-disk] saved ${filePath} ads=${doc.ads.length}`);
}

/**
 * @param {string} channelId
 * @returns {Promise<object | null>}
 */
export async function readChannelSnapshotById(channelId) {
  return readJsonIfExists(channelFilePath(channelId));
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

export { resolveBaseUrl as resolveHlsBaseUrl };
