/**
 * Live HLS: logo-detector (OpenCV) on each channel’s stream URL.
 * - Discovery: all tenants are queried in parallel (Promise.all).
 * - Each channel runs its own async loop; probes on different channels run concurrently.
 * - Live probe cadence: LIVE_LOGO_PROBE_INTERVAL_MS in logo-pipeline (default 200ms ≈ 5/s).
 * Persists state to logo-live-matching-state.json and merges liveStream* into data/channels/<id>.json.
 */

import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive } from "./channels.service.js";
import {
  getLiveLogoStreamProbeUrl,
  LIVE_LOGO_PROBE_INTERVAL_MS,
  resolveChannelLogoPathsForMatching,
  runLogoDetectorOnStream,
} from "./logo-pipeline.service.js";
import { mergeChannelSnapshotFields, resolveHlsBaseUrl } from "./channel-ads-disk.service.js";

/** Consecutive live samples (one probe ≈ one frame grab) without logo before an ad window opens. */
const MIN_ABSENT_TO_OPEN = 3;
/** Fallback if first-absent epoch is missing (should not happen). */
const AD_START_LOOKBACK_SEC = 10;
/** Consecutive samples with logo before closing an ad window (back to program). */
const MIN_PRESENT_TO_CLOSE = 3;

/** Throttle stderr logs when a channel has no uploaded logos yet (paths re-checked every loop). */
const lastMissingLogoLogMs = new Map();
const MISSING_LOGO_LOG_INTERVAL_MS = 60_000;

/** channelId -> { kind: 'ok'|'absent'|'error', count } — consecutive log streak per channel */
const logoLiveLogStreak = new Map();

/** ISO timestamp for every [logo-live] log line. */
function logoLiveNow() {
  return new Date().toISOString();
}

/** Max code points for channel title in probe logs (Hebrew / long names truncated). */
const LOGO_LIVE_PROBE_LABEL_MAX_CP = 22;

/**
 * @param {string} text
 * @param {number} maxCp
 */
function truncateUnicodeCodePoints(text, maxCp) {
  const chars = [...String(text)];
  if (chars.length <= maxCp) return chars.join("");
  return chars.slice(0, maxCp - 1).join("") + "\u2026";
}

/**
 * Truncate then pad with spaces to maxCp so log lines stay aligned (monospace-friendly).
 * @param {string} text
 * @param {number} maxCp
 */
function formatLogoLiveProbeLabelSlot(text, maxCp) {
  const t = truncateUnicodeCodePoints(text, maxCp);
  const n = [...t].length;
  return n < maxCp ? t + " ".repeat(maxCp - n) : t;
}

/**
 * @param {LiveChannelState} st
 * @param {string} channelId
 */
function logoLiveLabelSlot(st, channelId) {
  const raw =
    typeof st.title === "string" && st.title.trim() !== "" ? st.title.trim() : channelId;
  return formatLogoLiveProbeLabelSlot(raw, LOGO_LIVE_PROBE_LABEL_MAX_CP);
}

/**
 * @param {"ok" | "absent" | "error"} kind
 * @param {{ adOpened?: boolean, adClosed?: boolean }} [flags] hysteresis: mark when ad window opens/closes
 */
function logLogoLiveStatus(st, channelId, kind, flags = {}) {
  const prev = logoLiveLogStreak.get(channelId);
  const count = prev && prev.kind === kind ? prev.count + 1 : 1;
  logoLiveLogStreak.set(channelId, { kind, count });

  const label = logoLiveLabelSlot(st, channelId);
  const sym = kind === "ok" ? "✅" : kind === "absent" ? "❌" : "⚠️";
  let line = `${label}:  ${sym} (${count})`;
  if (kind === "error" && typeof st.lastError === "string" && st.lastError.trim() !== "") {
    line += ` | ${st.lastError.trim()}`;
  }
  if (flags.adOpened) line += " -- AD start --";
  if (flags.adClosed) line += " -- AD end --";
  console.log(`[logo-live] ${logoLiveNow()} ${line}`);
}

/** Channel IDs that should keep probing (refreshed from API). */
const liveChannelWanted = new Set();
/** channelId -> in-flight loop promise */
const channelLoopTasks = new Map();

let serviceRunning = false;
let loopPromise = null;

/** Serializes load/save of logo-live-matching-state.json (avoids lost updates); detector runs still overlap across channels. */
let persistChain = Promise.resolve();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fileExistsBin(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function tenantsForLive() {
  const extra = config.logoLiveMatching.tenantIds;
  return extra.length > 0 ? extra : config.tenants;
}

/** @param {{ hlsStream?: string, hlsMaster?: string }} row */
function channelHlsUrl(row) {
  return row.hlsStream || row.hlsMaster || "";
}

/**
 * @typedef {{
 *   tenantId: string,
 *   title: string,
 *   hlsStream: string,
 *   falseStreak: number,
 *   trueStreak: number,
 *   inAd: boolean,
 *   adWindowStartEpoch: number | null,
 *   absentStreakStartEpoch: number | null,
 *   presentStreakStartEpoch: number | null,
 *   adConfirmWallSec: number | null,
 *   lastProbeWallMs: number | null,
 *   avgProbeIntervalMs: number | null,
 *   segments: Array<Record<string, unknown>>,
 *   lastLogo: boolean | null,
 *   lastMatchScore: number | null,
 *   lastProbeAt: string | null,
 *   lastError: string | null,
 * }} LiveChannelState
 */

/**
 * Hysteresis using wall clock at the instant each probe result is applied (aligned with debug frame “now”).
 * - First absent: `absentStreakStartEpoch = floor(Date.now()/1000)` at that tick.
 * - AD opens after MIN_ABSENT_TO_OPEN consecutive absents; `adWindowStartEpoch` is the **first** absent second
 *   (AD content begins from that instant; confirmation lags by (N-1) probe intervals — see hysteresis*Nominal).
 * - AD closes after MIN_PRESENT_TO_CLOSE consecutive presents; `endEpoch` is the **first** present second in that streak.
 * - `adConfirmWallSec` stores the wall second when the open streak confirmed (Nth absent sample), for JSON lag metadata.
 * @param {LiveChannelState} st
 * @param {boolean} logoPresent
 * @param {number} wallNowSec `Math.floor(Date.now()/1000)` when registering this probe outcome
 */
function applyHysteresisSample(st, logoPresent, wallNowSec) {
  const nominalMs = LIVE_LOGO_PROBE_INTERVAL_MS;
  const avgMs = st.avgProbeIntervalMs ?? nominalMs;
  const hysteresisStartOffsetSec = Math.round(((MIN_ABSENT_TO_OPEN - 1) * avgMs) / 1000);
  const hysteresisEndOffsetSec = Math.round(((MIN_PRESENT_TO_CLOSE - 1) * avgMs) / 1000);

  if (logoPresent) {
    if (st.inAd && st.trueStreak === 0) {
      st.presentStreakStartEpoch = wallNowSec;
    }
    st.trueStreak += 1;
    st.falseStreak = 0;
    st.absentStreakStartEpoch = null;
    if (st.inAd && st.trueStreak >= MIN_PRESENT_TO_CLOSE) {
      const endEpoch =
        st.presentStreakStartEpoch != null
          ? Math.max(0, st.presentStreakStartEpoch)
          : Math.max(0, wallNowSec - hysteresisEndOffsetSec);
      if (st.adWindowStartEpoch != null && endEpoch >= st.adWindowStartEpoch) {
        const confirmLagStartSec =
          st.adConfirmWallSec != null ? Math.max(0, st.adConfirmWallSec - st.adWindowStartEpoch) : null;
        st.segments.push({
          startEpoch: st.adWindowStartEpoch,
          endEpoch,
          timestampSource: "wall_clock_date_now",
          hysteresisAbsentSamples: MIN_ABSENT_TO_OPEN,
          hysteresisPresentSamples: MIN_PRESENT_TO_CLOSE,
          estimatedAvgProbeIntervalMs: Math.round(avgMs),
          hysteresisStartOffsetSecNominal: hysteresisStartOffsetSec,
          hysteresisEndOffsetSecNominal: hysteresisEndOffsetSec,
          wallClockAbsentConfirmLagSec: confirmLagStartSec,
        });
      }
      st.inAd = false;
      st.adWindowStartEpoch = null;
      st.adConfirmWallSec = null;
      st.trueStreak = 0;
      st.presentStreakStartEpoch = null;
    }
  } else {
    if (!st.inAd && st.falseStreak === 0) {
      st.absentStreakStartEpoch = wallNowSec;
    }
    st.falseStreak += 1;
    st.trueStreak = 0;
    st.presentStreakStartEpoch = null;
    if (!st.inAd && st.falseStreak >= MIN_ABSENT_TO_OPEN) {
      st.inAd = true;
      st.adConfirmWallSec = wallNowSec;
      st.adWindowStartEpoch =
        st.absentStreakStartEpoch != null
          ? Math.max(0, st.absentStreakStartEpoch)
          : Math.max(0, wallNowSec - Math.max(AD_START_LOOKBACK_SEC, hysteresisStartOffsetSec));
      st.falseStreak = 0;
      st.absentStreakStartEpoch = null;
    }
  }
  st.lastLogo = logoPresent;
}

async function loadState() {
  try {
    const raw = await fs.readFile(config.logoLiveMatching.stateFilePath, "utf8");
    const o = JSON.parse(raw);
    if (o && typeof o === "object" && o.channels && typeof o.channels === "object") return o;
  } catch (e) {
    if (e.code !== "ENOENT") console.warn(`[logo-live] ${logoLiveNow()} state read:`, e.message);
  }
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    serviceStartedAt: new Date().toISOString(),
    channels: {},
  };
}

async function saveState(doc) {
  doc.savedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(config.logoLiveMatching.stateFilePath), { recursive: true });
  const tmp = `${config.logoLiveMatching.stateFilePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
  await fs.rename(tmp, config.logoLiveMatching.stateFilePath);
}

/**
 * @param {() => Promise<void>} fn
 */
function withPersistLock(fn) {
  const next = persistChain.then(() => fn()).catch((e) => {
    console.error(`[logo-live] ${logoLiveNow()} persist error:`, e.message);
  });
  persistChain = next;
  return next;
}

/** @param {LiveChannelState} st */
function cloneChannelState(st) {
  return {
    tenantId: st.tenantId,
    title: st.title,
    hlsStream: st.hlsStream,
    falseStreak: st.falseStreak,
    trueStreak: st.trueStreak,
    inAd: st.inAd,
    adWindowStartEpoch: st.adWindowStartEpoch,
    absentStreakStartEpoch: st.absentStreakStartEpoch ?? null,
    presentStreakStartEpoch: st.presentStreakStartEpoch ?? null,
    adConfirmWallSec: st.adConfirmWallSec ?? null,
    lastProbeWallMs: st.lastProbeWallMs ?? null,
    avgProbeIntervalMs: st.avgProbeIntervalMs ?? null,
    segments: Array.isArray(st.segments) ? st.segments.map((s) => ({ ...s })) : [],
    lastLogo: st.lastLogo,
    lastMatchScore: st.lastMatchScore,
    lastProbeAt: st.lastProbeAt,
    lastError: st.lastError,
  };
}

/**
 * @param {string} channelId
 * @param {LiveChannelState} st
 */
function persistLiveRow(channelId, st) {
  return withPersistLock(async () => {
    const state = await loadState();
    if (!state.channels[channelId]) state.channels[channelId] = {};
    state.channels[channelId] = cloneChannelState(st);
    await saveState(state);
  });
}

/**
 * Requires at least one uploaded logo in channel settings (see Channel settings UI).
 * @returns {Promise<{ ok: boolean, paths: string[] }>}
 */
async function ensureLogoSourcesForChannel(channelId, st) {
  const paths = await resolveChannelLogoPathsForMatching(channelId);
  if (paths.length > 0) {
    lastMissingLogoLogMs.delete(channelId);
    return { ok: true, paths };
  }

  st.lastError = "logo_assets_missing";
  const nowMs = Date.now();
  const lastLog = lastMissingLogoLogMs.get(channelId) ?? 0;
  if (nowMs - lastLog >= MISSING_LOGO_LOG_INTERVAL_MS) {
    logLogoLiveStatus(st, channelId, "error");
    lastMissingLogoLogMs.set(channelId, nowMs);
  }
  return { ok: false, paths: [] };
}

/**
 * @param {Record<string, LiveChannelState>} channels
 * @param {string} channelId
 * @param {{ tenantId: string, title: string, hlsStream: string }} meta
 */
function ensureChannelRow(channels, channelId, meta) {
  if (!channels[channelId]) {
    channels[channelId] = {
      tenantId: meta.tenantId,
      title: meta.title,
      hlsStream: meta.hlsStream,
      falseStreak: 0,
      trueStreak: 0,
      inAd: false,
      adWindowStartEpoch: null,
      absentStreakStartEpoch: null,
      presentStreakStartEpoch: null,
      adConfirmWallSec: null,
      lastProbeWallMs: null,
      avgProbeIntervalMs: null,
      segments: [],
      lastLogo: null,
      lastMatchScore: null,
      lastProbeAt: null,
      lastError: null,
    };
  } else {
    channels[channelId].tenantId = meta.tenantId;
    channels[channelId].title = meta.title;
    channels[channelId].hlsStream = meta.hlsStream;
    if (!Array.isArray(channels[channelId].segments)) channels[channelId].segments = [];
    if (channels[channelId].absentStreakStartEpoch === undefined) {
      channels[channelId].absentStreakStartEpoch = null;
    }
    if (channels[channelId].presentStreakStartEpoch === undefined) {
      channels[channelId].presentStreakStartEpoch = null;
    }
    if (channels[channelId].adConfirmWallSec === undefined) {
      channels[channelId].adConfirmWallSec = null;
    }
    if (channels[channelId].lastProbeWallMs === undefined) {
      channels[channelId].lastProbeWallMs = null;
    }
    if (channels[channelId].avgProbeIntervalMs === undefined) {
      channels[channelId].avgProbeIntervalMs = null;
    }
  }
  return channels[channelId];
}

async function tickChannel(channelId, st, logoPaths) {
  st.lastProbeAt = new Date().toISOString();
  st.lastError = null;

  if (!(await fileExistsBin(config.logoDetector.bin))) {
    st.lastError = "logo_detector_binary_missing";
    logLogoLiveStatus(st, channelId, "error");
    return;
  }

  const { m3u8Url: probeM3u8 } = getLiveLogoStreamProbeUrl(st.hlsStream);

  const detectorFailure = {};
  const timeoutMs = config.logoLiveMatching.probeTimeoutMs;
  let probe = await runLogoDetectorOnStream(probeM3u8, logoPaths, {
    timeoutMs,
    channelId,
    failureRef: detectorFailure,
    liveProbeIntervalMs: LIVE_LOGO_PROBE_INTERVAL_MS,
  });
  if (!probe && config.logoLiveMatching.probeFallbackRaw) {
    detectorFailure.reason = undefined;
    probe = await runLogoDetectorOnStream(st.hlsStream, logoPaths, {
      timeoutMs,
      channelId,
      failureRef: detectorFailure,
      liveProbeIntervalMs: LIVE_LOGO_PROBE_INTERVAL_MS,
    });
  }

  if (!probe) {
    st.lastError = detectorFailure.reason
      ? `detector:${detectorFailure.reason}`
      : "logo_detector_failed";
    logLogoLiveStatus(st, channelId, "error");
    return;
  }

  const wallMs = Date.now();
  const wallNowSec = Math.floor(wallMs / 1000);
  if (st.lastProbeWallMs != null) {
    const delta = wallMs - st.lastProbeWallMs;
    if (delta > 500 && delta < 600_000) {
      st.avgProbeIntervalMs =
        st.avgProbeIntervalMs == null ? delta : st.avgProbeIntervalMs * 0.82 + delta * 0.18;
    }
  }
  st.lastProbeWallMs = wallMs;

  const skipped = probe.match_skipped === true;
  const score = typeof probe.match_score === "number" ? probe.match_score : 0;
  st.lastMatchScore = score;
  const logoPresent = skipped ? false : probe.logo === true || probe.logo_present === true;
  const wasInAd = st.inAd;
  applyHysteresisSample(st, logoPresent, wallNowSec);
  const adOpened = !wasInAd && st.inAd;
  const adClosed = wasInAd && !st.inAd;
  if (logoPresent) {
    logLogoLiveStatus(st, channelId, "ok", { adClosed });
  } else {
    logLogoLiveStatus(st, channelId, "absent", { adOpened });
  }

  await mergeChannelSnapshotFields(channelId, {
    tenantId: st.tenantId,
    hlsBaseUrl: resolveHlsBaseUrl(st.hlsStream),
    liveStreamAdSegments: st.segments.slice(),
    liveStreamAdTimestampSource: "wall_clock_date_now",
    liveStreamInAd: st.inAd,
    liveStreamAdStartEpoch: st.adWindowStartEpoch,
    liveStreamLastLogo: st.lastLogo,
    liveStreamLastMatchScore: st.lastMatchScore,
    liveStreamLastProbeAt: st.lastProbeAt,
    liveStreamLastError: st.lastError,
  });
}

async function runOneChannelLoop(channelId) {
  /** Minimum time between probe starts for this channel (parallel across channels). */
  const interval = Math.max(1, LIVE_LOGO_PROBE_INTERVAL_MS);

  while (serviceRunning && liveChannelWanted.has(channelId)) {
    const t0 = Date.now();
    try {
      const state = await loadState();
      const st = state.channels[channelId];
      if (!st || !st.hlsStream) {
        await sleep(interval);
        continue;
      }

      const ready = await ensureLogoSourcesForChannel(channelId, st);
      if (ready.ok) {
        await tickChannel(channelId, st, ready.paths);
      } else {
        st.lastProbeAt = new Date().toISOString();
        await mergeChannelSnapshotFields(channelId, {
          tenantId: st.tenantId,
          hlsBaseUrl: resolveHlsBaseUrl(st.hlsStream),
          liveStreamLastError: st.lastError,
          liveStreamLastProbeAt: st.lastProbeAt,
        });
      }
      await persistLiveRow(channelId, st);
    } catch (e) {
      console.error(`[logo-live] ${logoLiveNow()} ${channelId}: ${e.message}`);
      try {
        const state = await loadState();
        const st = state.channels[channelId];
        if (st) {
          st.lastError = e.message;
          await persistLiveRow(channelId, st);
        }
      } catch {
        /* ignore */
      }
    }

    const elapsed = Date.now() - t0;
    await sleep(Math.max(0, interval - elapsed));
  }
}

function spawnChannelLoopIfNeeded(channelId) {
  if (channelLoopTasks.has(channelId)) return;
  const p = runOneChannelLoop(channelId);
  channelLoopTasks.set(channelId, p);
  p.catch((e) => console.error(`[logo-live] ${logoLiveNow()} loop crashed ${channelId}:`, e.message)).finally(() => {
    channelLoopTasks.delete(channelId);
    if (serviceRunning && liveChannelWanted.has(channelId)) {
      setTimeout(() => spawnChannelLoopIfNeeded(channelId), 5000);
    }
  });
}

async function discoveryTick() {
  const fetched = new Set();
  /** @type {Array<{ channelId: string, tenantId: string, title: string, hlsStream: string }>} */
  const discovered = [];

  const tenantIds = tenantsForLive();
  const tenantResults = await Promise.all(
    tenantIds.map(async (tenantId) => {
      try {
        const t = await resolveTenant(tenantId);
        const rows = await fetchChannelsWithArchive({ accountId: t.accountId, tenantId });
        return { ok: true, tenantId, rows };
      } catch (e) {
        return { ok: false, tenantId, error: e && typeof e.message === "string" ? e.message : String(e) };
      }
    }),
  );

  for (const tr of tenantResults) {
    if (!tr.ok) {
      console.error(`[logo-live] ${logoLiveNow()} tenant ${tr.tenantId}: ${tr.error}`);
      continue;
    }
    for (const row of tr.rows) {
      const channelId = String(row._id);
      const hls = channelHlsUrl(row);
      if (!hls) continue;
      fetched.add(channelId);
      discovered.push({
        channelId,
        tenantId: tr.tenantId,
        title: row.title || "",
        hlsStream: hls,
      });
    }
  }

  try {
    await withPersistLock(async () => {
      const state = await loadState();
      if (!state.serviceStartedAt) state.serviceStartedAt = new Date().toISOString();
      for (const d of discovered) {
        ensureChannelRow(state.channels, d.channelId, {
          tenantId: d.tenantId,
          title: d.title,
          hlsStream: d.hlsStream,
        });
      }
      await saveState(state);
    });
  } catch (e) {
    console.error(`[logo-live] ${logoLiveNow()} discovery persist: ${e.message}`);
  }

  for (const id of fetched) {
    liveChannelWanted.add(id);
    spawnChannelLoopIfNeeded(id);
  }
  for (const id of [...liveChannelWanted]) {
    if (!fetched.has(id)) liveChannelWanted.delete(id);
  }
}

async function discoveryLoop() {
  const period = Math.max(5000, config.logoLiveMatching.discoveryIntervalMs);
  await discoveryTick();
  while (serviceRunning) {
    await sleep(period);
    if (!serviceRunning) break;
    await discoveryTick();
  }
}

export function startLogoLiveMatchingService() {
  if (!config.logoLiveMatching.enabled) {
    console.log(`[logo-live] ${logoLiveNow()} Disabled (LOGO_LIVE_MATCHING_ENABLED=false)`);
    return;
  }
  if (serviceRunning) return;
  serviceRunning = true;
  const probeGap = Math.max(1, LIVE_LOGO_PROBE_INTERVAL_MS);
  console.log(
    `[logo-live] ${logoLiveNow()} Started: parallel tenant discovery, one concurrent loop per channel, ≥${probeGap}ms between probes per channel`,
  );
  loopPromise = discoveryLoop();
  loopPromise.catch((e) => console.error(`[logo-live] ${logoLiveNow()} fatal:`, e));
}

export function stopLogoLiveMatchingService() {
  serviceRunning = false;
  liveChannelWanted.clear();
}
