/**
 * Channel logos from settings UI + logo-detector OpenCV CLI (m3u8 URL + local template paths).
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { listUploadedLogoAbsolutePaths } from "./channel-settings.service.js";

/**
 * Target milliseconds between live logo probes per channel (orchestrator cadence).
 * 200 ms ≈ 5 probes per second. Passed to logo-detector as --live-probe-interval-ms (echoed in JSON).
 */
export const LIVE_LOGO_PROBE_INTERVAL_MS = 2000;

/**
 * @param {string} hlsStream base channel URL; startTime/endTime are set for archive window
 * @param {number} startEpoch inclusive unix seconds
 * @param {number} endEpoch exclusive unix seconds
 */
export function buildArchiveM3u8(hlsStream, startEpoch, endEpoch) {
  const u = new URL(hlsStream);
  u.searchParams.set("startTime", String(startEpoch));
  u.searchParams.set("endTime", String(endEpoch));
  return u.toString();
}

/**
 * Live logo probe URL: `startTime` = current unix second, **`endTime` removed** so the origin serves a
 * sliding/live playlist (not a bounded VOD-style window that lags the UI). Archive scans keep using
 * {@link buildArchiveM3u8} with both bounds.
 *
 * @param {string} hlsStream base channel URL (e.g. .../streamPlaylist.m3u8)
 * @returns {{ m3u8Url: string, mediaAnchorEpoch: number }} mediaAnchorEpoch = startTime sent (clock for hysteresis)
 */
export function getLiveLogoStreamProbeUrl(hlsStream) {
  const u = new URL(hlsStream);
  const mediaAnchorEpoch = Math.floor(Date.now() / 1000);
  u.searchParams.set("startTime", String(mediaAnchorEpoch));
  u.searchParams.delete("endTime");
  return { m3u8Url: u.toString(), mediaAnchorEpoch };
}

/** @param {string} hlsStream */
export function buildLiveLogoProbeM3u8(hlsStream) {
  return getLiveLogoStreamProbeUrl(hlsStream).m3u8Url;
}

function runExecutable(binPath, args, { cwd, timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: env || process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${binPath}: timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const tail = stderr.slice(-3000) || stdout.slice(-3000);
        reject(new Error(`exit ${code}: ${tail}`));
      }
    });
  });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function parseProbeJsonFromStdout(stdout) {
  const raw = stdout.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * @param {string} channelId
 * @returns {Promise<string[]>}
 */
export async function resolveChannelLogoPathsForMatching(channelId) {
  return listUploadedLogoAbsolutePaths(channelId);
}

/**
 * Safe file segment for debug JPEG filename (matches channel logo dirs convention).
 * @param {string} [channelId]
 */
export function sanitizeChannelIdForLogoDebug(channelId) {
  return String(channelId ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Absolute path to the last debug frame for this channel (overwritten each probe).
 * @param {string} [channelId]
 */
export function resolveLogoDetectorDebugImagePath(channelId) {
  const safe = sanitizeChannelIdForLogoDebug(channelId);
  return path.join(config.logoDetector.debugImageDir, `logo-detector-debug-${safe}.jpg`);
}

/** @param {string | undefined} channelId */
function logoDetectorChildEnv(channelId) {
  const d = config.logoDetector;
  const env = {
    ...process.env,
    LOGO_DETECTOR_THRESHOLD: String(d.threshold),
    LOGO_DETECTOR_SCALE_MIN: String(d.scaleMin),
    LOGO_DETECTOR_SCALE_MAX: String(d.scaleMax),
    LOGO_DETECTOR_SCALE_STEPS: String(d.scaleSteps),
  };
  if (d.debugLogoDetector) {
    env.LOGO_DETECTOR_DEBUG = "1";
    env.LOGO_DETECTOR_DEBUG_PATH = resolveLogoDetectorDebugImagePath(channelId);
  }
  return env;
}

/**
 * @param {{ reason?: string } | undefined} ref
 * @param {string} reason
 */
function setDetectorFailureReason(ref, reason) {
  if (ref && typeof ref === "object") ref.reason = reason;
}

/**
 * @param {string} m3u8Url
 * @param {string[]} logoAbsPaths
 * @param {{ timeoutMs?: number, channelId?: string, failureRef?: { reason?: string }, liveProbeIntervalMs?: number }} [opts]
 *   When `liveProbeIntervalMs` is a positive integer, passes `--live-probe-interval-ms` to the binary (echoed in JSON).
 */
export async function runLogoDetectorOnStream(m3u8Url, logoAbsPaths, opts = {}) {
  const failRef = opts.failureRef;
  const bin = config.logoDetector.bin;
  const cwd = config.logoDetector.dir;
  if (!(await fileExists(bin))) {
    setDetectorFailureReason(failRef, "binary_missing");
    return null;
  }
  if (!m3u8Url || !logoAbsPaths.length) {
    setDetectorFailureReason(failRef, "missing_url_or_logo_paths");
    return null;
  }
  const d = config.logoDetector;
  const args = [];
  if (d.debugLogoDetector) args.push("--debug");
  const liveMs = opts.liveProbeIntervalMs;
  if (typeof liveMs === "number" && Number.isFinite(liveMs) && liveMs >= 1) {
    args.push("--live-probe-interval-ms", String(Math.floor(liveMs)));
  }
  args.push(...logoAbsPaths, m3u8Url);
  const timeoutMs = opts.timeoutMs ?? config.logoLiveMatching.probeTimeoutMs;
  try {
    const { stdout } = await runExecutable(bin, args, {
      cwd,
      timeoutMs,
      env: logoDetectorChildEnv(opts.channelId),
    });
    const probe = parseProbeJsonFromStdout(stdout);
    if (!probe || probe.ok === false) {
      setDetectorFailureReason(failRef, !probe ? "invalid_probe_json" : "probe_ok_false");
      return null;
    }
    return probe;
  } catch (e) {
    const msg = e && typeof e.message === "string" ? e.message : String(e);
    const short = msg.length > 120 ? `${msg.slice(0, 117)}...` : msg;
    setDetectorFailureReason(failRef, short);
    return null;
  }
}
