/**
 * In-memory logo-scan bookkeeping with JSON persistence so restarts skip already-processed matcher slots.
 * Template matching runs per matcherWindowSeconds (default 2 min); fragments align with fragmentSeconds.
 */

import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { absoluteAdIntervalFromMatcherSegment } from "./matcher-time-map.service.js";

const SAVE_DEBOUNCE_MS = 800;

/** @typedef {{ startEpoch: number, endEpoch: number, hadLogoAbsence: boolean, adOverlapSeconds: number, hourStartEpoch: number, slotStartEpoch?: number }} FragmentRecord */

const processedSlotsByChannel = new Map(); // channelKey -> Set<number> (matcher slot start epoch)
const backfillCompleteByChannel = new Map(); // channelKey -> boolean
const fragmentsByKey = new Map(); // fragmentKey -> FragmentRecord
/** channelKey -> epoch ms when logo-detector last completed successfully (24h reuse window). */
const detectorSuccessAtMsByChannel = new Map();
let saveTimer = null;

function channelKey(tenantId, channelId) {
  return `${tenantId}:${channelId}`;
}

function fragmentKey(tenantId, channelId, fragmentStartEpoch) {
  return `${channelKey(tenantId, channelId)}@${fragmentStartEpoch}`;
}

function matcherWindowSec() {
  return config.logoScan.matcherWindowSeconds;
}

function alignEpochToHour(epochSec) {
  return Math.floor(epochSec / config.logoScan.hourSeconds) * config.logoScan.hourSeconds;
}

export function alignEpochToMatcherSlot(epochSec) {
  const w = matcherWindowSec();
  return Math.floor(epochSec / w) * w;
}

/** Oldest instant we keep ads/fragments for (unix seconds). */
export function retentionCutoffEpoch(nowSec) {
  return nowSec - config.logoScan.archiveHours * 3600;
}

/** Earliest matcher slot start (inclusive) to walk: within retention and matcherArchiveHours. */
export function matcherScanCutoffEpoch(nowSec) {
  const retention = retentionCutoffEpoch(nowSec);
  const archiveCap = nowSec - config.logoScan.matcherArchiveHours * 3600;
  return Math.max(retention, archiveCap);
}

/**
 * True when every matcher slot from latestSlotStart down to matcherScanCutoffEpoch(now) is processed.
 * Used to choose catch-up sweep vs latest-window-only refresh.
 */
export function hasFullMatcherArchiveCoverage(tenantId, channelId, nowSec, latestSlotStart) {
  const slotSec = matcherWindowSec();
  const scanCutoff = matcherScanCutoffEpoch(nowSec);
  for (let s = latestSlotStart; s >= scanCutoff; s -= slotSec) {
    if (!isMatcherSlotProcessed(tenantId, channelId, s)) return false;
  }
  return true;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistToDisk().catch((err) => console.error("[logo-scan-state] persist failed:", err.message));
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Serialize current state for disk.
 */
function snapshot() {
  const slots = {};
  for (const [k, set] of processedSlotsByChannel) {
    slots[k] = [...set].sort((a, b) => a - b);
  }
  const backfill = Object.fromEntries(backfillCompleteByChannel);
  const fragments = [...fragmentsByKey.values()].sort((a, b) => a.startEpoch - b.startEpoch);
  const detectorCache = Object.fromEntries(detectorSuccessAtMsByChannel);
  return { version: 3, savedAt: new Date().toISOString(), slots, backfill, fragments, detectorCache };
}

export async function persistToDisk() {
  const filePath = config.logoScan.stateFilePath;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(snapshot(), null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

function migrateHoursToSlots(hoursObj) {
  const w = matcherWindowSec();
  const out = {};
  for (const [k, arr] of Object.entries(hoursObj)) {
    const set = new Set();
    for (const H of Array.isArray(arr) ? arr : []) {
      const hourStart = Math.floor(Number(H) / config.logoScan.hourSeconds) * config.logoScan.hourSeconds;
      for (let t = hourStart; t < hourStart + config.logoScan.hourSeconds; t += w) {
        set.add(t);
      }
    }
    out[k] = set;
  }
  return out;
}

export async function loadFromDisk() {
  const filePath = config.logoScan.stateFilePath;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    processedSlotsByChannel.clear();
    backfillCompleteByChannel.clear();
    fragmentsByKey.clear();
    detectorSuccessAtMsByChannel.clear();
    if (data.slots && typeof data.slots === "object" && !Array.isArray(data.slots)) {
      for (const [k, arr] of Object.entries(data.slots)) {
        processedSlotsByChannel.set(k, new Set(Array.isArray(arr) ? arr : []));
      }
    } else if (data.hours && typeof data.hours === "object") {
      const migrated = migrateHoursToSlots(data.hours);
      for (const [k, set] of Object.entries(migrated)) {
        processedSlotsByChannel.set(k, set);
      }
      if (config.logoScan.verbose) {
        console.log("[logo-scan-state] Migrated processed hours → matcher-sized slots");
      }
    }
    if (data.backfill && typeof data.backfill === "object") {
      for (const [k, v] of Object.entries(data.backfill)) {
        backfillCompleteByChannel.set(k, Boolean(v));
      }
    }
    if (Array.isArray(data.fragments)) {
      for (const fr of data.fragments) {
        if (fr && typeof fr.startEpoch === "number") {
          const fk = fragmentKeyFromRecord(fr);
          fragmentsByKey.set(fk, fr);
        }
      }
    }
    if (data.detectorCache && typeof data.detectorCache === "object") {
      for (const [k, v] of Object.entries(data.detectorCache)) {
        const n = typeof v === "number" ? v : Date.parse(v);
        if (!Number.isNaN(n)) detectorSuccessAtMsByChannel.set(k, n);
      }
    }
    if (config.logoScan.verbose) {
      console.log(
        `[logo-scan-state] Loaded state: ${processedSlotsByChannel.size} channel(s), ${fragmentsByKey.size} fragment(s), ` +
          `detectorCache=${detectorSuccessAtMsByChannel.size}`,
      );
    }
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.warn("[logo-scan-state] Could not load state file:", e.message);
    }
  }
}

function fragmentKeyFromRecord(fr) {
  return fragmentKey(fr.tenantId, fr.channelId, fr.startEpoch);
}

export function isMatcherSlotProcessed(tenantId, channelId, slotStartEpoch) {
  const s = alignEpochToMatcherSlot(slotStartEpoch);
  const set = processedSlotsByChannel.get(channelKey(tenantId, channelId));
  return set ? set.has(s) : false;
}

export function markMatcherSlotProcessed(tenantId, channelId, slotStartEpoch) {
  const s = alignEpochToMatcherSlot(slotStartEpoch);
  const key = channelKey(tenantId, channelId);
  if (!processedSlotsByChannel.has(key)) processedSlotsByChannel.set(key, new Set());
  processedSlotsByChannel.get(key).add(s);
  scheduleSave();
}

export function isBackfillComplete(tenantId, channelId) {
  return backfillCompleteByChannel.get(channelKey(tenantId, channelId)) === true;
}

export function setBackfillComplete(tenantId, channelId, done) {
  backfillCompleteByChannel.set(channelKey(tenantId, channelId), done);
  scheduleSave();
}

/**
 * Record fragment rows for one matcher run. Ad overlap uses the same anchor as matcher-time-map
 * (PDT-based `mediaTimelineZeroEpochUtc` when provided).
 */
export function recordMatcherSlotFragments(
  tenantId,
  channelId,
  playlistStartTimeEpoch,
  playlistEndTimeEpoch,
  adSegments,
  timeMapOptions = {},
) {
  const fragSec = config.logoScan.fragmentSeconds;
  const urlStart = Number(playlistStartTimeEpoch);
  const urlEnd = Number(playlistEndTimeEpoch);
  if (!Number.isFinite(urlStart) || !Number.isFinite(urlEnd) || urlEnd <= urlStart) {
    return;
  }
  const hourH = alignEpochToHour(urlStart);

  for (let t = urlStart; t < urlEnd; t += fragSec) {
    const fragStart = t;
    const fragEnd = Math.min(t + fragSec, urlEnd);
    let adOverlap = 0;
    for (const seg of adSegments || []) {
      const abs = absoluteAdIntervalFromMatcherSegment(urlStart, urlEnd, seg, timeMapOptions);
      if (!abs) continue;
      const lo = Math.max(fragStart, abs.startEpoch);
      const hi = Math.min(fragEnd, abs.endEpoch);
      if (hi > lo) adOverlap += hi - lo;
    }
    const hadLogoAbsence = adOverlap > 0;
    const rec = {
      tenantId,
      channelId,
      hourStartEpoch: hourH,
      slotStartEpoch: urlStart,
      startEpoch: fragStart,
      endEpoch: fragEnd,
      hadLogoAbsence,
      adOverlapSeconds: Math.round(adOverlap * 1000) / 1000,
    };
    fragmentsByKey.set(fragmentKey(tenantId, channelId, fragStart), rec);
  }
  scheduleSave();
}

/**
 * Drop fragment records (and trim processed slot markers) older than retention.
 * @param {number} cutoffEpoch fragments with endEpoch <= cutoffEpoch are removed
 */
export function pruneFragmentsOlderThan(cutoffEpoch) {
  const w = matcherWindowSec();
  for (const [k, fr] of fragmentsByKey) {
    if (fr.endEpoch <= cutoffEpoch) fragmentsByKey.delete(k);
  }
  for (const [ck, set] of processedSlotsByChannel) {
    for (const slotStart of [...set]) {
      if (slotStart + w <= cutoffEpoch) set.delete(slotStart);
    }
  }
  scheduleSave();
}

export function getFragmentsForChannel(tenantId, channelId) {
  const prefix = `${channelKey(tenantId, channelId)}@`;
  return [...fragmentsByKey.entries()]
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v)
    .sort((a, b) => a.startEpoch - b.startEpoch);
}

export function getStateSummary() {
  let slotTotal = 0;
  for (const set of processedSlotsByChannel.values()) slotTotal += set.size;
  return {
    channelsTracked: processedSlotsByChannel.size,
    matcherSlotsTracked: slotTotal,
    fragmentCount: fragmentsByKey.size,
    backfillCompleteCount: [...backfillCompleteByChannel.values()].filter(Boolean).length,
    detectorCacheEntries: detectorSuccessAtMsByChannel.size,
  };
}

/**
 * True if we recorded a successful detector run within detectorCacheTtlMs (use with on-disk JSON+JPG).
 */
export function isDetectorCacheFresh(tenantId, channelId) {
  const at = detectorSuccessAtMsByChannel.get(channelKey(tenantId, channelId));
  if (at == null) return false;
  return Date.now() - at < config.logoScan.detectorCacheTtlMs;
}

export function markDetectorSuccessful(tenantId, channelId) {
  detectorSuccessAtMsByChannel.set(channelKey(tenantId, channelId), Date.now());
  scheduleSave();
}

export function getDetectorCacheExpiryIso(tenantId, channelId) {
  const at = detectorSuccessAtMsByChannel.get(channelKey(tenantId, channelId));
  if (at == null) return null;
  return new Date(at + config.logoScan.detectorCacheTtlMs).toISOString();
}
