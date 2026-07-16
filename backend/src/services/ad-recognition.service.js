/**
 * AD recognition scheduler.
 *
 * Every `config.adRecognition.intervalMs` (default 10s) this service probes ALL archive-enabled
 * channels IN PARALLEL by POSTing the trimmed VOD window + the per-channel rule-engine config to
 * the external `insight-ad-recognition` service:
 *
 *   POST {baseUrl}/detect  { video: <channel HLS + window>, config }  ->  { detection, score, ... }
 *
 * A hysteresis window turns the per-probe verdicts into live ad segments:
 *   - An ad window OPENS after {@link AD_CONFIRM_SAMPLES} consecutive "ad" detections.
 *   - The window CLOSES after {@link PROGRAM_CONFIRM_SAMPLES} consecutive "program" detections.
 *   - Any other verdict (unknown/error) breaks the current streak (neither opens nor closes).
 *
 * Segments are merged into the per-channel snapshot (`liveStreamAdSegments`), so the existing
 * ads timeline (`ads-precalc.service.js`) keeps working unchanged. Channels without an active
 * detection config are skipped.
 */

import { Op } from "sequelize";
import { config } from "../config.js";
import { getSequelize, isSequelizeReady } from "../db/sequelize.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive } from "./channels.service.js";
import { listAdRecognitionEnabledTenantIds } from "./tenant-visit.service.js";
import {
  mergeChannelSnapshotFields,
  readChannelSnapshotById,
  resolveHlsBaseUrl,
} from "./channel-ads-disk.service.js";
import { getChannelConfig, hasActiveStrategies } from "./ad-recognition-config.service.js";

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
 * Minimum ad-window duration (seconds) to be recorded as a segment. Windows shorter than this are
 * discarded on close: even if AD_CONFIRM_SAMPLES "ad" probes opened a window, if "program" resumes
 * before this many seconds elapse, it does NOT form an ad slot. Configurable via env.
 */
export const MIN_AD_SEGMENT_SECONDS = Math.max(0, config.adRecognition.minAdSegmentSec);

/**
 * Archive probe window length (seconds). `endTime = startTime + PROBE_WINDOW_SECONDS`.
 * The detect service keeps only the LAST keyframe of this window.
 * Env: AD_RECOGNITION_PROBE_WINDOW_SEC (default 60).
 */
export const PROBE_WINDOW_SECONDS = () => Math.max(1, config.adRecognition.probeWindowSec);

/**
 * Heuristic: DVR/archive playlists that only return media when given a startTime/endTime window.
 * Covers the `-archive` playlists, the `fillgaps` proxy and the immergo encoder DVR origin
 * (`encoders.immergo.tv`), whose path is a plain `streamPlaylist.m3u8` but still needs the window.
 */
function needsArchiveWindow(url) {
  return /archive|fillgaps|encoders\.immergo\.tv/i.test(url);
}

/**
 * Detect upstream-origin failures in the microservice's error message. These typically resolve on
 * a second try with a further-back window (the origin's packager caught up), so `probeChannel`
 * treats them as retriable. Anything else (network error to the microservice itself, timeout,
 * detector bug) is NOT retried to avoid amplifying real outages.
 * @param {string} msg
 */
function isRetriableUpstreamError(msg) {
  if (!msg) return false;
  // Bubbled up from the microservice as `Analysis failed: HTTP 4xx fetching <origin url>` or
  // `Analysis failed: ffmpeg produced no frames (code=1): <url>: Server returned 5XX Server Error`.
  return /HTTP\s+(4\d\d|5\d\d)\s+fetching/i.test(msg) || /Server returned\s+\dXX/i.test(msg);
}

/**
 * Build the URL to probe. For archive/DVR playlists without an explicit window, append
 * `startTime`/`endTime` covering a `probeWindowSec`-long window (default 60s) whose `endTime`
 * is deferred `archiveMarginSec` (default 60s → exactly 1 minute) behind `now`, so we always
 * hit media the origin has already consolidated.
 *
 * The detect service extracts the LAST keyframe of that window, and the caller stamps the marker
 * epoch at `endTime` (the media / PROGRAM-DATE-TIME axis). Because the marker uses `endTime` and
 * not the wall clock, the 1-minute deferral is inherently accounted for: ad start/end land on the
 * real stream timeline with no loss of precision.
 * Live playlists are left untouched.
 * @param {string} hls
 * @param {number} [marginSec] override the default deferral (used by the retry path).
 */
export function buildProbeUrl(hls, marginSec) {
  try {
    const u = new URL(hls);
    const alreadyWindowed = u.searchParams.has("startTime") || u.searchParams.has("endTime");
    if (!alreadyWindowed && needsArchiveWindow(hls)) {
      const now = Math.floor(Date.now() / 1000);
      const margin = Math.max(
        0,
        Number.isFinite(marginSec) ? Number(marginSec) : config.adRecognition.archiveMarginSec,
      );
      const windowSec = PROBE_WINDOW_SECONDS();
      const end = now - margin;
      const start = end - windowSec;
      u.searchParams.set("startTime", String(start));
      u.searchParams.set("endTime", String(end));
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

/**
 * Tenants to probe this cycle: EVERY tenant known to this service that has opted into AD recognition
 * (`adRecognitionEnabled === true` in the DB). There is no hardcoded tenant list — the admin flag is
 * the single source of truth. `AD_RECOGNITION_TENANTS` (env) is only an optional restriction: when
 * set, we probe the intersection with the enabled tenants (handy for debugging a single tenant).
 * @returns {Promise<string[]>}
 */
async function tenantsForRecognition() {
  if (!isSequelizeReady()) return [];
  let enabled;
  try {
    enabled = await listAdRecognitionEnabledTenantIds();
  } catch (e) {
    console.warn("[ad-recognition] enabled-tenants query failed:", e && e.message ? e.message : e);
    return [];
  }
  const allowlist = config.adRecognition.tenantIds;
  if (allowlist.length > 0) {
    const set = new Set(allowlist);
    return enabled.filter((id) => set.has(id));
  }
  return enabled;
}

/** @param {{ hlsStream?: string, hlsMaster?: string }} row */
function channelHlsUrl(row) {
  return row.hlsStream || row.hlsMaster || "";
}

/**
 * Purge ALL ad markers of a channel: delete every `ad_recognition_scans` row from the DB and reset
 * the live ad segments + hysteresis (in-memory state + persisted snapshot) so the ad timeline is
 * cleared too. Used by the admin "Clear all AD markers" button.
 * @param {string} channelId
 * @returns {Promise<{ deleted: number }>}
 */
export async function purgeChannelAdMarkers(channelId) {
  const cid = String(channelId || "").trim();
  if (!cid) return { deleted: 0 };

  let deleted = 0;
  const sequelize = getSequelize();
  const Model = sequelize?.models?.AdRecognitionScan;
  if (Model) {
    try {
      deleted = await Model.destroy({ where: { channelId: cid } });
    } catch (e) {
      console.warn("[ad-recognition] purge scans failed:", e && e.message ? e.message : e);
    }
  }

  // Reset in-memory hysteresis so a new probe starts from a clean slate.
  channelStates.delete(cid);

  // Clear the persisted ad segments / open-ad state in the channel snapshot (the ad timeline).
  try {
    await mergeChannelSnapshotFields(cid, {
      liveStreamAdSegments: [],
      liveStreamInAd: false,
      liveStreamAdStartEpoch: null,
      liveStreamLastDetection: null,
      liveStreamLastScore: null,
    });
  } catch (e) {
    console.warn("[ad-recognition] purge snapshot failed:", e && e.message ? e.message : e);
  }

  return { deleted };
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
 * @param {"ad"|"program"|"silence"|string} detection
 * @param {number} epoch unix seconds for this sample (from the detect response `timestamp`)
 */
export function applyDetection(st, detection, epoch) {
  let closedSegment = null;
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
      // Only record the ad slot if it met the minimum duration; otherwise discard the short burst.
      if (
        st.adStartEpoch != null &&
        endEpoch > st.adStartEpoch &&
        endEpoch - st.adStartEpoch >= MIN_AD_SEGMENT_SECONDS
      ) {
        const seg = { startEpoch: st.adStartEpoch, endEpoch };
        st.segments.push(seg);
        closedSegment = seg; // reference kept in st.segments; the polish job refines it in place
      }
      st.inAd = false;
      st.adStartEpoch = null;
      st.pendingProgramEpoch = null;
    }
  } else {
    // "silence" / unknown: breaks consecutiveness for both entry and exit.
    st.adStreak = 0;
    st.programStreak = 0;
  }
  // The just-closed ad segment (a live reference into st.segments), or null. Callers use this to
  // trigger the frame-accurate boundary polish once we have enough evidence it's a real ad.
  return closedSegment;
}

/** Drop segments older than the ads retention window to bound memory / snapshot growth. */
function trimOldSegments(segments) {
  const cutoff = Math.floor(Date.now() / 1000) - config.adsRetentionHours * 3600;
  return segments.filter((s) => s.endEpoch > cutoff);
}

/**
 * Call the microservice POST /detect with the trimmed VOD window + the per-channel rule config.
 * @param {string} hlsUrl
 * @param {object} channelConfig per-channel rule-engine config
 */
async function callDetect(hlsUrl, channelConfig) {
  const url = `${config.adRecognition.baseUrl}/detect`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.adRecognition.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": config.adRecognition.secret,
      },
      body: JSON.stringify({ video: hlsUrl, config: channelConfig || {} }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`detect HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Extract the `endTime` (unix seconds) query param from a probe URL, or null. */
function probeEndTime(probeUrl) {
  try {
    const v = new URL(probeUrl).searchParams.get("endTime");
    const n = v != null ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Insert one scan row into the DB (best-effort; never throws to the caller).
 * @param {object} scan AdRecognitionScan attributes
 */
async function persistScanToDb(scan) {
  const sequelize = getSequelize();
  const Model = sequelize?.models?.AdRecognitionScan;
  if (!Model) return;
  try {
    await Model.create(scan);
  } catch (e) {
    console.warn("[ad-recognition] scan DB insert failed:", e && e.message ? e.message : e);
  }
}

/** Drop scan rows older than the ads retention window to bound table growth. */
async function pruneOldScansFromDb() {
  const sequelize = getSequelize();
  const Model = sequelize?.models?.AdRecognitionScan;
  if (!Model) return;
  const cutoff = new Date(Date.now() - config.adsRetentionHours * 3600 * 1000);
  try {
    await Model.destroy({ where: { scannedAt: { [Op.lt]: cutoff } } });
  } catch (e) {
    console.warn("[ad-recognition] scan prune failed:", e && e.message ? e.message : e);
  }
}

async function probeChannel(channel) {
  const { channelId, tenantId, hls, title } = channel;

  // Skip channels that have no active detection config (no strategy enabled). This keeps the pulse
  // free of channels the operator hasn't set up in the "Ad Recognition Setup" tab.
  const channelConfig = await getChannelConfig(channelId).catch(() => null);
  const cfg = channelConfig?.config || null;
  if (!cfg || !hasActiveStrategies(cfg)) return;

  const st = await getOrInitState(channelId, { tenantId, hlsStream: hls });
  st.lastProbeAt = new Date().toISOString();
  const scannedAt = new Date();

  // Archive/DVR playlists need a bounded window (last PROBE_WINDOW_SECONDS + a safety margin so
  // we don't land inside the origin's packaging delay); live playlists pass as-is.
  let probeUrl = buildProbeUrl(hls);

  let result;
  let lastError = null;
  try {
    result = await callDetect(probeUrl, cfg);
  } catch (e) {
    lastError = e && typeof e.message === "string" ? e.message : String(e);
    // Upstream origin hiccup? Retry ONCE with a further-back window before giving up. The
    // extended margin trades a bit of freshness for a much higher chance of hitting segments
    // that the origin has already packaged.
    if (isRetriableUpstreamError(lastError)) {
      const retryUrl = buildProbeUrl(hls, config.adRecognition.archiveRetryMarginSec);
      if (retryUrl !== probeUrl) {
        try {
          console.warn(
            `[ad-recognition] upstream error, retrying with extended margin ` +
              `(${config.adRecognition.archiveRetryMarginSec}s) channel=${channelId}: ${lastError}`,
          );
          result = await callDetect(retryUrl, cfg);
          probeUrl = retryUrl;
          lastError = null;
        } catch (e2) {
          lastError = e2 && typeof e2.message === "string" ? e2.message : String(e2);
        }
      }
    }
  }

  if (!result) {
    st.lastError = lastError;
    await persistChannel(channelId, st);
    await persistScanToDb({
      tenantId,
      channelId,
      channelTitle: title || null,
      hlsUrl: probeUrl,
      detection: "error",
      score: null,
      confidence: null,
      scores: null,
      ocrText: null,
      ocrTextTranslated: null,
      elapsedMs: null,
      strategyResults: null,
      error: lastError,
      probeEpoch: Math.floor(Date.now() / 1000),
      scannedAt,
    });
    return;
  }

  const detection = typeof result?.detection === "string" ? result.detection : "unknown";
  const score = typeof result?.score === "number" ? result.score : null;
  // Use the probe window's endTime (the media time of the analyzed frame) as the marker epoch, so
  // segments land on the stream's real timeline (PROGRAM-DATE-TIME) instead of the wall clock — the
  // microservice's `timestamp` is just processing time and would shift markers by ~margin seconds.
  const epoch =
    probeEndTime(probeUrl) ??
    (typeof result?.timestamp === "number" ? result.timestamp : Math.floor(Date.now() / 1000));

  st.lastError = null;
  st.lastDetection = detection;
  st.lastScore = score;

  const closedSegment = applyDetection(st, detection, epoch);
  st.segments = trimOldSegments(st.segments);

  // Positive recognition log: full detect JSON alongside the requested m3u8 (channel title + probed URL).
  console.log(
    `[ad-recognition] detect OK title="${title || channelId}" tenant=${tenantId} ` +
      `detection=${detection} score=${score} took=${result?.elapsedMs}ms m3u8=${probeUrl}`,
  );

  await persistChannel(channelId, st);

  // A confirmed ad window just closed (>= min duration) — refine its boundaries to frame accuracy in
  // the background. Fire-and-forget: never blocks the probe loop.
  if (closedSegment && config.adRecognition.polishEnabled) {
    void polishSegment({ channelId, hls }, closedSegment, cfg).catch((e) =>
      console.warn("[ad-recognition] polish dispatch failed:", e && e.message ? e.message : e),
    );
  }
  await persistScanToDb({
    tenantId,
    channelId,
    channelTitle: title || null,
    hlsUrl: probeUrl,
    detection,
    score,
    // `confidence` column carries the applied ad/program threshold.
    confidence: typeof result?.threshold === "number" ? result.threshold : null,
    scores: result?.scores ?? null,
    ocrText: typeof result?.ocrText === "string" ? result.ocrText : null,
    ocrTextTranslated: typeof result?.ocrTextEn === "string" ? result.ocrTextEn : null,
    elapsedMs: typeof result?.elapsedMs === "number" ? result.elapsedMs : null,
    strategyResults: result?.strategyResults ?? null,
    error: null,
    probeEpoch: epoch,
    scannedAt,
  });
}

/** Build a scan URL over an explicit [startEpoch, endEpoch] archive window. */
function buildScanUrl(hls, startEpoch, endEpoch) {
  try {
    const u = new URL(hls);
    u.searchParams.set("startTime", String(Math.floor(startEpoch)));
    u.searchParams.set("endTime", String(Math.floor(endEpoch)));
    return u.toString();
  } catch {
    return hls;
  }
}

/** Call the microservice /scan for a window; returns { frames:[{epoch,detection,score}], ... } or null. */
async function callScan(hls, startEpoch, endEpoch, channelConfig) {
  const url = `${config.adRecognition.baseUrl}/scan`;
  const video = buildScanUrl(hls, startEpoch, endEpoch);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.adRecognition.polishTimeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-secret": config.adRecognition.secret },
      body: JSON.stringify({ video, config: channelConfig || {}, fps: config.adRecognition.polishFps }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`scan HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Minimum consecutive ad frames to treat a run as real (filters isolated noise in the scan). */
function scanMinRun() {
  return Math.max(1, Math.ceil(config.adRecognition.polishFps * 1.5));
}

/** First epoch where a sustained ad run begins (program -> ad), or null. */
function findStartTransition(scan) {
  const frames = (scan?.frames || []).filter((f) => f && typeof f.epoch === "number");
  const minRun = scanMinRun();
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].detection !== "ad") continue;
    let run = 0;
    for (let j = i; j < frames.length && frames[j].detection === "ad"; j++) run++;
    if (run >= minRun) return frames[i].epoch;
  }
  return null;
}

/** First program epoch right after the LAST sustained ad run (ad -> program), or null. */
function findEndTransition(scan) {
  const frames = (scan?.frames || []).filter((f) => f && typeof f.epoch === "number");
  const minRun = scanMinRun();
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].detection !== "ad") continue;
    let run = 0;
    for (let j = i; j >= 0 && frames[j].detection === "ad"; j--) run++;
    if (run >= minRun) {
      const next = frames[i + 1];
      return next ? next.epoch : frames[i].epoch;
    }
  }
  return null;
}

/**
 * Frame-accurate boundary polish: refine a confirmed ad segment's start/end by scanning +/- margin
 * around each boundary. Mutates the segment (a live reference in st.segments) and re-persists.
 * Best-effort background job; never throws to the caller.
 * @param {{ channelId: string, hls: string }} channel
 * @param {{ startEpoch: number, endEpoch: number, polished?: boolean }} seg
 * @param {object} channelConfig
 */
export async function polishSegment(channel, seg, channelConfig) {
  if (!config.adRecognition.polishEnabled) return;
  if (!seg || seg.polished) return;
  const { channelId, hls } = channel;
  if (!needsArchiveWindow(hls)) return; // can only rescan an addressable archive window
  const margin = Math.max(5, config.adRecognition.polishMarginSec);

  try {
    const origStart = seg.startEpoch;
    const origEnd = seg.endEpoch;

    const [startScan, endScan] = await Promise.all([
      callScan(hls, origStart - margin, origStart + margin, channelConfig).catch(() => null),
      callScan(hls, origEnd - margin, origEnd + margin, channelConfig).catch(() => null),
    ]);

    const refinedStart = startScan ? findStartTransition(startScan) : null;
    const refinedEnd = endScan ? findEndTransition(endScan) : null;

    // Keep refined values only when they are near the original boundary and stay a valid window.
    const newStart =
      refinedStart != null && Math.abs(refinedStart - origStart) <= margin ? refinedStart : origStart;
    const newEnd =
      refinedEnd != null && Math.abs(refinedEnd - origEnd) <= margin ? refinedEnd : origEnd;

    if (newStart < newEnd && newEnd - newStart >= MIN_AD_SEGMENT_SECONDS) {
      seg.startEpoch = newStart;
      seg.endEpoch = newEnd;
    }
    seg.polished = true;

    const st = channelStates.get(channelId);
    if (st) await persistChannel(channelId, st);
    console.log(
      `[ad-recognition] polished segment channel=${channelId} ` +
        `start ${origStart}->${seg.startEpoch} end ${origEnd}->${seg.endEpoch}`,
    );
  } catch (e) {
    console.warn("[ad-recognition] polish failed:", e && e.message ? e.message : e);
  }
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
  const tenantIds = await tenantsForRecognition();
  if (tenantIds.length === 0) return [];

  const results = await Promise.all(
    tenantIds.map(async (tenantId) => {
      try {
        const t = await resolveTenant(tenantId);
        const rows = await fetchChannelsWithArchive({ accountId: t.accountId, tenantId });
        return { tenantId, rows };
      } catch (e) {
        console.warn(
          `[ad-recognition] channel discovery failed tenant=${tenantId}:`,
          e && e.message ? e.message : e,
        );
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

  // Every cycle: list the m3u8 URLs that will be analyzed this round (confirms discovery is working).
  if (channels.length === 0) {
    console.log(
      "[ad-recognition] cycle: 0 channel(s) to analyze " +
        "(no tenant with adRecognitionEnabled=true, or none of their channels have archive/hls)",
    );
  } else {
    const lines = channels
      .map((c, i) => `  ${i + 1}. title="${c.title}" tenant=${c.tenantId} m3u8=${buildProbeUrl(c.hls)}`)
      .join("\n");
    console.log(`[ad-recognition] cycle: analyzing ${channels.length} channel(s):\n${lines}`);
  }

  if (channels.length === 0) return;
  // All channels probed in parallel; one slow/failing channel does not block the others.
  await Promise.allSettled(channels.map((c) => probeChannel(c)));
  // Bound the scan history table (once per cycle, best-effort).
  await pruneOldScansFromDb();
}

async function schedulerLoop() {
  const interval = Math.max(2000, config.adRecognition.intervalMs);
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
