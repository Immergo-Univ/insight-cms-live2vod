/**
 * Channel logos from settings UI + logo-detector OpenCV CLI (m3u8 URL + local template paths).
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { listUploadedLogoAbsolutePaths } from "./channel-settings.service.js";

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

function logoDetectorChildEnv() {
  const d = config.logoDetector;
  return {
    ...process.env,
    LOGO_DETECTOR_THRESHOLD: String(d.threshold),
    LOGO_DETECTOR_SCALE_MIN: String(d.scaleMin),
    LOGO_DETECTOR_SCALE_MAX: String(d.scaleMax),
    LOGO_DETECTOR_SCALE_STEPS: String(d.scaleSteps),
  };
}

/**
 * @param {string} m3u8Url
 * @param {string[]} logoAbsPaths
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function runLogoDetectorOnStream(m3u8Url, logoAbsPaths, opts = {}) {
  const bin = config.logoDetector.bin;
  const cwd = config.logoDetector.dir;
  if (!(await fileExists(bin))) {
    console.error(`[logo-detector] Missing binary: ${bin} (make -C utils/logo-detector)`);
    return null;
  }
  if (!m3u8Url || !logoAbsPaths.length) return null;
  const args = [...logoAbsPaths, m3u8Url];
  const timeoutMs = opts.timeoutMs ?? config.logoLiveMatching.probeTimeoutMs;
  try {
    const { stdout, stderr } = await runExecutable(bin, args, {
      cwd,
      timeoutMs,
      env: logoDetectorChildEnv(),
    });
    if (stderr && process.env.LOGO_LIVE_DEBUG === "true") {
      console.error(stderr.slice(-2000));
    }
    const probe = parseProbeJsonFromStdout(stdout);
    if (!probe || probe.ok === false) {
      console.error(`[logo-detector] bad JSON or ok=false: ${stdout.slice(0, 400)}`);
      return null;
    }
    return probe;
  } catch (e) {
    console.error(`[logo-detector] ${e.message}`);
    return null;
  }
}
