/**
 * AD recognition scheduler.
 *
 * Every `config.adRecognition.intervalMs` (default 30s) this service probes ALL archive-enabled
 * channels IN PARALLEL by calling the external `insight-ad-recognition` service:
 *
 *   GET {baseUrl}/detect?video=<channel HLS>&secret=<secret>  ->  { detection: "ad"|"program"|"black", ... }
 *
 * A hysteresis window turns the per-probe verdicts into live ad segments:
 *   - An ad window OPENS after {@link AD_CONFIRM_SAMPLES} consecutive "ad" detections.
 *   - The window CLOSES after {@link PROGRAM_CONFIRM_SAMPLES} consecutive "program" detections.
 *   - Any other verdict ("black"/unknown) breaks the current streak (neither opens nor closes).
 *
 * Segments are merged into the per-channel snapshot (`liveStreamAdSegments`), so the existing
 * ads timeline (`ads-precalc.service.js`) keeps working unchanged. This replaces the former
 * OpenCV logo-detector pipeline.
 */

import { config } from "../config.js";
import { isSequelizeReady } from "../db/sequelize.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive } from "./channels.service.js";
import { getTenantById } from "./tenant-visit.service.js";
import {
  mergeChannelSnapshotFields,
  readChannelSnapshotById,
  resolveHlsBaseUrl,
} from "./channel-ads-disk.service.js";

/**
 * Consecutive "ad" detections required to OPEN an ad window.
 * Adjust here to change the entry confirmation threshold.
 */
export const AD_CONFIRM_SAMPLES = 3;

/**
 * Consecutive "program" detections required to CLOSE an ad window.
 * Adjust here to change the exit confirmation threshold.
 */
export const PROGRAM_CONFIRM_SAMPLES = 3;

/**
 * Some channel HLS URLs are DVR/archive playlists (e.g. `streamPlaylist-archive.m3u8` or the
 * `fillgaps` proxy) that only serve content when given a bounded window via startTime/endTime.
 * For those we request the last N seconds on every probe so the origin returns a small playlist
 * (the detect service then samples the live edge of that window). Change here if needed.
 */
export const PROBE_WINDOW_SECONDS = 120;

/**
 * Heuristic: DVR/archive playlists that only return media when given a startTime/endTime window.
 * Covers the `-archive` playlists, the `fillgaps` proxy and the immergo encoder DVR origin
 * (`encoders.immergo.tv`), whose path is a plain `streamPlaylist.m3u8` but still needs the window.
 */
function needsArchiveWindow(url) {
  return /archive|fillgaps|encoders\.immergo\.tv/i.test(url);
}

/**
 * Build the URL to probe. For archive/DVR playlists without an explicit window, append
 * `startTime`/`endTime` for the last {@link PROBE_WINDOW_SECONDS} seconds. Live playlists are
 * left untouched.
 * @param {string} hls
 */
export function buildProbeUrl(hls) {
  try {
    const u = new URL(hls);
    const alreadyWindowed = u.searchParams.has("startTime") || u.searchParams.has("endTime");
    if (!alreadyWindowed && needsArchiveWindow(hls)) {
      const now = Math.floor(Date.now() / 1000);
      u.searchParams.set("startTime", String(now - PROBE_WINDOW_SECONDS));
      u.searchParams.set("endTime", String(now));
    }
    return u.toString();
  } catch {
    return hls;
  }
}

let serviceRunning = false;
let loopPromise = null;

/** channelId -> hysteresis state (in memory; segments are also persisted to the snapshot). */
const channelStates = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tenantsForRecognition() {
  const extra = config.adRecognition.tenantIds;
  return extra.length > 0 ? extra : config.tenants;
}

/** @param {{ hlsStream?: string, hlsMaster?: string }} row */
function channelHlsUrl(row) {
  return row.hlsStream || row.hlsMaster || "";
}

/**
 * Whether AD recognition should run for a tenant. This is strictly OPT-IN: it only runs when the
 * tenant row exists and has `adRecognitionEnabled === true`. Any other case (DB unavailable,
 * tenant deleted/missing, flag off) → disabled, so nothing is probed unless explicitly activated.
 */
async function isTenantAdRecognitionEnabled(tenantId) {
  try {
    if (!isSequelizeReady()) return false;
    const tenant = await getTenantById(tenantId);
    return tenant?.adRecognitionEnabled === true;
  } catch {
    return false;
  }
}

/**
 * Drop in-memory hysteresis state for all channels of a tenant (used when a tenant is deleted).
 * @param {string} tenantId
 */
export function purgeTenantFromMemory(tenantId) {
  const tid = String(tenantId || "").trim();
  if (!tid) return;
  for (const [channelId, st] of channelStates.entries()) {
    if (st && String(st.tenantId || "") === tid) channelStates.delete(channelId);
  }
}

/**
 * Lazily create the per-channel state, seeding existing segments / open-ad state from the snapshot
 * so a process restart does not lose already-detected ad windows.
 */
async function getOrInitState(channelId, meta) {
  let st = channelStates.get(channelId);
  if (st) {
    st.tenantId = meta.tenantId;
    st.hlsStream = meta.hlsStream;
    return st;
  }

  let seededSegments = [];
  let seededInAd = false;
  let seededAdStart = null;
  try {
    const snap = await readChannelSnapshotById(channelId);
    if (Array.isArray(snap?.liveStreamAdSegments)) {
      seededSegments = snap.liveStreamAdSegments
        .filter((s) => s && typeof s.startEpoch === "number" && typeof s.endEpoch === "number")
        .map((s) => ({ startEpoch: s.startEpoch, endEpoch: s.endEpoch }));
    }
    seededInAd = snap?.liveStreamInAd === true;
    seededAdStart = typeof snap?.liveStreamAdStartEpoch === "number" ? snap.liveStreamAdStartEpoch : null;
  } catch {
    /* fresh state */
  }

  st = {
    tenantId: meta.tenantId,
    hlsStream: meta.hlsStream,
    adStreak: 0,
    programStreak: 0,
    inAd: seededInAd,
    adStartEpoch: seededAdStart,
    pendingAdStartEpoch: null,
    pendingProgramEpoch: null,
    segments: seededSegments,
    lastDetection: null,
    lastScore: null,
    lastProbeAt: null,
    lastError: null,
  };
  channelStates.set(channelId, st);
  return st;
}

/**
 * Apply one detection verdict to the hysteresis state, mutating it in place.
 * @param {object} st channel state
 * @param {"ad"|"program"|"black"|string} detection
 * @param {number} epoch unix seconds for this sample (from the detect response `timestamp`)
 */
export function applyDetection(st, detection, epoch) {
  if (detection === "ad") {
    if (st.adStreak === 0) st.pendingAdStartEpoch = epoch; // first "ad" of a new streak
    st.adStreak += 1;
    st.programStreak = 0;
    if (!st.inAd && st.adStreak >= AD_CONFIRM_SAMPLES) {
      st.inAd = true;
      st.adStartEpoch = st.pendingAdStartEpoch ?? epoch;
    }
  } else if (detection === "program") {
    if (st.inAd && st.programStreak === 0) st.pendingProgramEpoch = epoch; // first "program" of closing streak
    st.programStreak += 1;
    st.adStreak = 0;
    if (st.inAd && st.programStreak >= PROGRAM_CONFIRM_SAMPLES) {
      const endEpoch = st.pendingProgramEpoch ?? epoch;
      if (st.adStartEpoch != null && endEpoch > st.adStartEpoch) {
        st.segments.push({ startEpoch: st.adStartEpoch, endEpoch });
      }
      st.inAd = false;
      st.adStartEpoch = null;
      st.pendingProgramEpoch = null;
    }
  } else {
    // "black" / unknown: breaks consecutiveness for both entry and exit.
    st.adStreak = 0;
    st.programStreak = 0;
  }
}

/** Drop segments older than the ads retention window to bound memory / snapshot growth. */
function trimOldSegments(segments) {
  const cutoff = Math.floor(Date.now() / 1000) - config.adsRetentionHours * 3600;
  return segments.filter((s) => s.endEpoch > cutoff);
}

async function callDetect(hlsUrl) {
  const url =
    `${config.adRecognition.baseUrl}/detect` +
    `?video=${encodeURIComponent(hlsUrl)}` +
    `&secret=${encodeURIComponent(config.adRecognition.secret)}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.adRecognition.requestTimeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`detect HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function probeChannel(channel) {
  const { channelId, tenantId, hls, title } = channel;
  const st = await getOrInitState(channelId, { tenantId, hlsStream: hls });
  st.lastProbeAt = new Date().toISOString();

  // Archive/DVR playlists need a bounded window (last PROBE_WINDOW_SECONDS); live playlists pass as-is.
  const probeUrl = buildProbeUrl(hls);

  let result;
  try {
    result = await callDetect(probeUrl);
  } catch (e) {
    st.lastError = e && typeof e.message === "string" ? e.message : String(e);
    await persistChannel(channelId, st);
    return;
  }

  const detection = typeof result?.detection === "string" ? result.detection : "unknown";
  const score = typeof result?.score === "number" ? result.score : null;
  const epoch =
    typeof result?.timestamp === "number" ? result.timestamp : Math.floor(Date.now() / 1000);

  st.lastError = null;
  st.lastDetection = detection;
  st.lastScore = score;

  applyDetection(st, detection, epoch);
  st.segments = trimOldSegments(st.segments);

  // Positive recognition log: full detect JSON alongside the requested m3u8 (channel title + probed URL).
  console.log(
    `[ad-recognition] detect OK title="${title || channelId}" tenant=${tenantId} ` +
      `detection=${detection} score=${score} m3u8=${probeUrl}\n` +
      JSON.stringify(result, null, 2),
  );

  await persistChannel(channelId, st);
}

async function persistChannel(channelId, st) {
  await mergeChannelSnapshotFields(channelId, {
    tenantId: st.tenantId,
    hlsBaseUrl: resolveHlsBaseUrl(st.hlsStream),
    liveStreamAdSegments: st.segments.slice(),
    liveStreamAdTimestampSource: "insight_ad_recognition",
    liveStreamInAd: st.inAd,
    liveStreamAdStartEpoch: st.adStartEpoch,
    liveStreamLastDetection: st.lastDetection,
    liveStreamLastScore: st.lastScore,
    liveStreamLastProbeAt: st.lastProbeAt,
    liveStreamLastError: st.lastError,
  });
}

async function discoverChannels() {
  /** @type {Array<{ channelId: string, tenantId: string, hls: string, title: string }>} */
  const discovered = [];
  const tenantIds = tenantsForRecognition();

  const results = await Promise.all(
    tenantIds.map(async (tenantId) => {
      try {
        // Skip tenants that have AD recognition disabled from their admin settings.
        if (!(await isTenantAdRecognitionEnabled(tenantId))) return { tenantId, rows: [] };
        const t = await resolveTenant(tenantId);
        const rows = await fetchChannelsWithArchive({ accountId: t.accountId, tenantId });
        return { tenantId, rows };
      } catch {
        return { tenantId, rows: [] };
      }
    }),
  );

  for (const { tenantId, rows } of results) {
    for (const row of rows) {
      const hls = channelHlsUrl(row);
      if (!hls) continue;
      const title = typeof row.title === "string" && row.title ? row.title : String(row._id);
      discovered.push({ channelId: String(row._id), tenantId, hls, title });
    }
  }
  return discovered;
}

async function runCycle() {
  const channels = await discoverChannels();
  if (channels.length === 0) return;
  // All channels probed in parallel; one slow/failing channel does not block the others.
  await Promise.allSettled(channels.map((c) => probeChannel(c)));
}

async function schedulerLoop() {
  const interval = Math.max(5000, config.adRecognition.intervalMs);
  while (serviceRunning) {
    const t0 = Date.now();
    try {
      await runCycle();
    } catch (e) {
      console.warn("[ad-recognition] cycle error:", e && e.message ? e.message : e);
    }
    if (!serviceRunning) break;
    const elapsed = Date.now() - t0;
    await sleep(Math.max(0, interval - elapsed));
  }
}

/** Start the periodic AD recognition scheduler (idempotent). */
export function startAdRecognitionService() {
  if (!config.adRecognition.enabled) {
    console.log("[ad-recognition] disabled (AD_RECOGNITION_ENABLED=false)");
    return;
  }
  if (serviceRunning) return;
  serviceRunning = true;
  console.log(
    `[ad-recognition] started — every ${config.adRecognition.intervalMs}ms against ${config.adRecognition.baseUrl}`,
  );
  loopPromise = schedulerLoop();
  loopPromise.catch(() => {});
}

export function stopAdRecognitionService() {
  serviceRunning = false;
}

export default { startAdRecognitionService, stopAdRecognitionService, applyDetection, purgeTenantFromMemory };
