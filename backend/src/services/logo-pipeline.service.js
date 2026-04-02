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
export const LIVE_LOGO_PROBE_INTERVAL_MS = 200;

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
 * DVR-style window ending at "now" so streamPlaylist returns a short m3u8 (not full archive).
 * Uses the same startTime/endTime query params as archive clips.
 *
 * @param {string} hlsStream base channel URL (e.g. .../streamPlaylist.m3u8)
 * @param {number} [windowSeconds] default 180; clamped 1..1800
 */
export function buildLiveLogoProbeM3u8(hlsStream, windowSeconds = 180) {
  const { m3u8Url } = getLiveLogoProbeWindow(hlsStream, windowSeconds);
  return m3u8Url;
}

/**
 * Single wall-clock tick for live probe: `endEpoch` matches the m3u8 `endTime` query param (stream media clock).
 * @param {string} hlsStream
 * @param {number} [windowSeconds]
 * @returns {{ m3u8Url: string, startEpoch: number, endEpoch: number }}
 */
export function getLiveLogoProbeWindow(hlsStream, windowSeconds = 180) {
  const w = Number(windowSeconds);
  const win = Number.isFinite(w) ? Math.min(1800, Math.max(1, Math.floor(w))) : 180;
  const endEpoch = Math.floor(Date.now() / 1000);
  const startEpoch = Math.max(0, endEpoch - win);
  return {
    endEpoch,
    startEpoch,
    m3u8Url: buildArchiveM3u8(hlsStream, startEpoch, endEpoch),
  };
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
    console.error(`[logo-detector] Missing binary: ${bin} (make -C utils/logo-detector)`);
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
    const { stdout, stderr } = await runExecutable(bin, args, {
      cwd,
      timeoutMs,
      env: logoDetectorChildEnv(opts.channelId),
    });
    if (stderr && process.env.LOGO_LIVE_DEBUG === "true") {
      console.error(stderr.slice(-2000));
    }
    const probe = parseProbeJsonFromStdout(stdout);
    if (!probe || probe.ok === false) {
      setDetectorFailureReason(failRef, !probe ? "invalid_probe_json" : "probe_ok_false");
      console.error(`[logo-detector] bad JSON or ok=false: ${stdout.slice(0, 400)}`);
      return null;
    }
    return probe;
  } catch (e) {
    const msg = e && typeof e.message === "string" ? e.message : String(e);
    const short = msg.length > 120 ? `${msg.slice(0, 117)}...` : msg;
    setDetectorFailureReason(failRef, short);
    console.error(`[logo-detector] ${e.message}`);
    return null;
  }
}
