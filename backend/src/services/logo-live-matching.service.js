/**
 * Live HLS: ~1 FPS probe per channel, independent loops (one slow stream cannot block others).
 * Persists state to logo-live-matching-state.json and merges liveStream* into data/channels/<id>.json.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { config } from "../config.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive } from "./channels.service.js";
import {
  hasDetectorArtifacts,
  runProbeTemplateMatch,
  runLogoDetector,
  buildDetectorArchiveM3u8,
} from "./logo-pipeline.service.js";
import { mergeChannelSnapshotFields, resolveHlsBaseUrl } from "./channel-ads-disk.service.js";

/** Consecutive live samples without logo before an ad window opens (1 sample ~= 1s). */
const MIN_ABSENT_TO_OPEN = 10;
/** Seconds to rewind ad start from confirm time (logo was absent during hysteresis but not yet confirmed). */
const AD_START_LOOKBACK_SEC = 10;
const MIN_PRESENT_TO_CLOSE = 2;

const detectorInFlight = new Map();
const detectorRetryAfterEpoch = new Map();

/** channelId -> { kind: 'ok'|'absent'|'error', count } — consecutive log streak per channel */
const logoLiveLogStreak = new Map();

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
  let line = `[logo-live] ${label}:  ${sym} (${count})`;
  if (flags.adOpened) line += " -- AD start --";
  if (flags.adClosed) line += " -- AD end --";
  console.log(line);
}

/** Channel IDs that should keep probing (refreshed from API). */
const liveChannelWanted = new Set();
/** channelId -> in-flight loop promise */
const channelLoopTasks = new Map();

let serviceRunning = false;
let loopPromise = null;

/** Serializes load/save of logo-live-matching-state.json */
let persistChain = Promise.resolve();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tenantsForLive() {
  const extra = config.logoLiveMatching.tenantIds;
  return extra.length > 0 ? extra : config.tenants;
}

/**
 * @param {string} hlsUrl
 * @param {string} outPath
 * @param {number} timeoutMs
 */
function grabOneFrameToFile(hlsUrl, outPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const child = spawn(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        hlsUrl,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        outPath,
      ],
      { stdio: "ignore" },
    );

    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish(new Error(`ffmpeg frame timeout ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`ffmpeg exit ${code}`));
    });
  });
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
 *   segments: Array<{ startEpoch: number, endEpoch: number }>,
 *   lastLogo: boolean | null,
 *   lastMatchScore: number | null,
 *   lastProbeAt: string | null,
 *   lastError: string | null,
 * }} LiveChannelState
 */

/**
 * @param {LiveChannelState} st
 * @param {boolean} logoPresent
 * @param {number} nowSec
 */
function applyHysteresisSample(st, logoPresent, nowSec) {
  if (logoPresent) {
    st.trueStreak += 1;
    st.falseStreak = 0;
    if (st.inAd && st.trueStreak >= MIN_PRESENT_TO_CLOSE) {
      const endEpoch = nowSec - MIN_PRESENT_TO_CLOSE;
      if (st.adWindowStartEpoch != null && endEpoch >= st.adWindowStartEpoch) {
        st.segments.push({ startEpoch: st.adWindowStartEpoch, endEpoch });
      }
      st.inAd = false;
      st.adWindowStartEpoch = null;
      st.trueStreak = 0;
    }
  } else {
    st.falseStreak += 1;
    st.trueStreak = 0;
    if (!st.inAd && st.falseStreak >= MIN_ABSENT_TO_OPEN) {
      st.inAd = true;
      st.adWindowStartEpoch = Math.max(0, nowSec - AD_START_LOOKBACK_SEC);
      st.falseStreak = 0;
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
    if (e.code !== "ENOENT") console.warn("[logo-live] state read:", e.message);
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
    console.error("[logo-live] persist error:", e.message);
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
 * Ensures detector JSON+JPG exist on disk. Reuses them if present; otherwise runs logo-detector once
 * against a short archive window (bbox extraction only).
 */
async function ensureDetectorArtifacts(channelId, hlsStream, st) {
  if (await hasDetectorArtifacts(channelId)) {
    detectorRetryAfterEpoch.delete(channelId);
    return true;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const retryAfter = detectorRetryAfterEpoch.get(channelId);
  if (retryAfter != null && nowSec < retryAfter) {
    st.lastError = "detector_cooldown";
    return false;
  }

  const pending = detectorInFlight.get(channelId);
  if (pending) {
    await pending;
    return hasDetectorArtifacts(channelId);
  }

  const latestHourStart =
    Math.floor(nowSec / config.logoScan.hourSeconds) * config.logoScan.hourSeconds;
  const detectorUrl = buildDetectorArchiveM3u8(hlsStream, latestHourStart);

  const run = (async () => {
    try {
      const ok = await runLogoDetector(detectorUrl, channelId);
      if (!ok) {
        detectorRetryAfterEpoch.set(channelId, Math.floor(Date.now() / 1000) + 120);
        st.lastError = "logo_detector_failed";
        logLogoLiveStatus(st, channelId, "error");
      } else {
        detectorRetryAfterEpoch.delete(channelId);
      }
    } finally {
      detectorInFlight.delete(channelId);
    }
  })();

  detectorInFlight.set(channelId, run);
  await run;
  return hasDetectorArtifacts(channelId);
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
  }
  return channels[channelId];
}

async function tickChannel(channelId, st, tmpFramePath) {
  const nowSec = Math.floor(Date.now() / 1000);
  st.lastProbeAt = new Date().toISOString();
  st.lastError = null;

  const ffMs = Math.max(5000, config.logoLiveMatching.ffmpegFrameTimeoutMs);

  try {
    await grabOneFrameToFile(st.hlsStream, tmpFramePath, ffMs);
  } catch (e) {
    st.lastError = e.message;
    logLogoLiveStatus(st, channelId, "error");
    return;
  }

  const probe = await runProbeTemplateMatch(tmpFramePath, channelId, {
    channelLabel: st.title,
  });
  if (!probe) {
    st.lastError = "probe_failed";
    logLogoLiveStatus(st, channelId, "error");
    return;
  }

  const skipped = probe.match_skipped === true;
  const score = typeof probe.match_score === "number" ? probe.match_score : 0;
  st.lastMatchScore = score;
  const logoPresent = skipped ? false : probe.logo === true || probe.logo_present === true;
  const wasInAd = st.inAd;
  applyHysteresisSample(st, logoPresent, nowSec);
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
    liveStreamInAd: st.inAd,
    liveStreamAdStartEpoch: st.adWindowStartEpoch,
    liveStreamLastLogo: st.lastLogo,
    liveStreamLastMatchScore: st.lastMatchScore,
    liveStreamLastProbeAt: st.lastProbeAt,
    liveStreamLastError: st.lastError,
  });
}

async function runOneChannelLoop(channelId) {
  const tmpFramePath = path.join(os.tmpdir(), `logo-live-${channelId}.jpg`);
  const interval = Math.max(200, config.logoLiveMatching.intervalMs);

  while (serviceRunning && liveChannelWanted.has(channelId)) {
    const t0 = Date.now();
    try {
      const state = await loadState();
      const st = state.channels[channelId];
      if (!st || !st.hlsStream) {
        await sleep(interval);
        continue;
      }

      const ready = await ensureDetectorArtifacts(channelId, st.hlsStream, st);
      if (ready) {
        await tickChannel(channelId, st, tmpFramePath);
      }
      await persistLiveRow(channelId, st);
    } catch (e) {
      console.error(`[logo-live] ${channelId}: ${e.message}`);
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
  p.catch((e) => console.error(`[logo-live] loop crashed ${channelId}:`, e.message)).finally(() => {
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

  for (const tenantId of tenantsForLive()) {
    let accountId;
    try {
      const t = await resolveTenant(tenantId);
      accountId = t.accountId;
    } catch (e) {
      console.error(`[logo-live] tenant ${tenantId}: ${e.message}`);
      continue;
    }

    let rows;
    try {
      rows = await fetchChannelsWithArchive({ accountId, tenantId });
    } catch (e) {
      console.error(`[logo-live] channels ${tenantId}: ${e.message}`);
      continue;
    }

    for (const row of rows) {
      const channelId = String(row._id);
      const hls = channelHlsUrl(row);
      if (!hls) continue;
      fetched.add(channelId);
      discovered.push({
        channelId,
        tenantId,
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
    console.error(`[logo-live] discovery persist: ${e.message}`);
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
    console.log("[logo-live] Disabled (LOGO_LIVE_MATCHING_ENABLED=false)");
    return;
  }
  if (serviceRunning) return;
  serviceRunning = true;
  loopPromise = discoveryLoop();
  loopPromise.catch((e) => console.error("[logo-live] fatal:", e));
}

export function stopLogoLiveMatchingService() {
  serviceRunning = false;
  liveChannelWanted.clear();
}
