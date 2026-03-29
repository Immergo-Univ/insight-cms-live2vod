/**
 * Spawn logo-detector and logo-template-matching CLIs (see backend/utils/logo-recognition.md).
 * Forwards subprocess stdout/stderr line-by-line so long matcher runs stay visible.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";

/**
 * @param {string} hlsStream base channel URL; startTime/endTime are set for archive window
 * @param {number} startEpoch inclusive unix seconds
 * @param {number} endEpoch exclusive unix seconds
 */
/** Sets `startTime` / `endTime` on the playlist URL (Unix epoch seconds). All ad timing is anchored to these, not m3u8 tags. */
export function buildArchiveM3u8(hlsStream, startEpoch, endEpoch) {
  const u = new URL(hlsStream);
  u.searchParams.set("startTime", String(startEpoch));
  u.searchParams.set("endTime", String(endEpoch));
  return u.toString();
}

/**
 * Multi-hour archive slice for logo-detector only: from (latestHourStart - (N-1)*hour) through latestHourStart+hour.
 * @param {string} hlsStream
 * @param {number} latestHourStartEpoch UTC start of the “current” hour used elsewhere in the scheduler
 */
export function buildDetectorArchiveM3u8(hlsStream, latestHourStartEpoch) {
  const hourSec = config.logoScan.hourSeconds;
  const n = Math.max(1, config.logoScan.detectorArchiveHours);
  const startEpoch = latestHourStartEpoch - (n - 1) * hourSec;
  const endEpoch = latestHourStartEpoch + hourSec;
  return buildArchiveM3u8(hlsStream, startEpoch, endEpoch);
}

function createLineForwarder(prefix) {
  let buf = "";
  return {
    push(chunk) {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length) console.log(`${prefix} ${line}`);
      }
    },
    flush() {
      const t = buf.trim();
      buf = "";
      if (t.length) console.log(`${prefix} ${t}`);
    },
  };
}

function runExecutable(binPath, args, { cwd, timeoutMs, stdoutPrefix, stderrPrefix }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const outFwd = stdoutPrefix ? createLineForwarder(stdoutPrefix) : null;
    const errFwd = stderrPrefix ? createLineForwarder(stderrPrefix) : null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
      if (outFwd) outFwd.push(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (errFwd) errFwd.push(d);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${stderrPrefix || binPath}: timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (outFwd) outFwd.flush();
      if (errFwd) errFwd.flush();
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
    await fs.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function getDetectorJsonPath(channelId) {
  return path.join(config.logoScan.logoDetectorDir, "output", `${channelId}.json`);
}

export function getDetectorLogoJpgPath(channelId) {
  return path.join(config.logoScan.logoDetectorDir, "output", `${channelId}_logo.jpg`);
}

/**
 * Both files must exist for template-matching to use cached detector output.
 */
export async function hasDetectorArtifacts(channelId) {
  const j = getDetectorJsonPath(channelId);
  const img = getDetectorLogoJpgPath(channelId);
  return (await fileExists(j)) && (await fileExists(img));
}

/**
 * @param {string} m3u8Url
 * @param {string} channelId
 * @returns {Promise<boolean>}
 */
export async function runLogoDetector(m3u8Url, channelId) {
  const bin = config.logoScan.logoDetectorBin;
  const cwd = config.logoScan.logoDetectorDir;
  if (!(await fileExists(bin))) {
    console.error(`[logo-scan] Missing binary: ${bin} (build logo-detector-features)`);
    return false;
  }
  console.log(
    `[logo-scan] STAGE logo-detector RUNNING channel=${channelId} cwd=${cwd}\n` +
      `[logo-scan]   argv: ${bin} <m3u8> ${channelId}`,
  );
  try {
    await runExecutable(bin, [m3u8Url, channelId], {
      cwd,
      timeoutMs: config.logoScan.detectorTimeoutMs,
      stdoutPrefix: "[logo-detector]",
      stderrPrefix: "[logo-detector]",
    });
    console.log(`[logo-scan] STAGE logo-detector DONE channel=${channelId}`);
    return true;
  } catch (e) {
    console.error(`[logo-scan] STAGE logo-detector FAILED channel=${channelId}: ${e.message}`);
    return false;
  }
}

/**
 * @param {string} m3u8Url
 * @param {string} channelId
 * @param {{ tenantId?: string, slotStartEpoch?: number, label?: string }} [ctx]
 * @returns {Promise<{ ad_segments: object[], scanned_duration_seconds: number, mediaTimelineZeroEpochUtc: number | null } | null>}
 */
export async function runTemplateMatcher(m3u8Url, channelId, ctx = {}) {
  const bin = config.logoScan.logoMatcherBin;
  const cwd = config.logoScan.logoMatcherDir;
  if (!(await fileExists(bin))) {
    console.error(`[logo-scan] Missing binary: ${bin} (build logo-template-matching)`);
    return null;
  }
  const detectorOutputDir = path.join(config.logoScan.logoDetectorDir, "output");
  const args = [
    m3u8Url,
    channelId,
    "--detector-output",
    detectorOutputDir,
    "--max-seconds",
    String(config.logoScan.matcherWindowSeconds + 120),
    "--threshold",
    String(config.logoScan.matcherMatchThreshold),
    "--search-pad-frac",
    String(config.logoScan.matcherSearchPadFrac),
  ];
  const scope =
    ctx.tenantId != null && ctx.slotStartEpoch != null
      ? `tenant=${ctx.tenantId} channel=${channelId} slotUTC=${ctx.slotStartEpoch}`
      : `channel=${channelId}`;
  const label = ctx.label ? `${ctx.label} ` : "";
  console.log(
    `[logo-scan] STAGE logo-template-matching RUNNING ${label}${scope}\n` +
      `[logo-scan]   cwd=${cwd}\n` +
      `[logo-scan]   (live progress below — one line per sample from the tool)\n` +
      `[logo-scan]   playlist: ${m3u8Url.slice(0, 120)}${m3u8Url.length > 120 ? "…" : ""}`,
  );
  try {
    await runExecutable(bin, args, {
      cwd,
      timeoutMs: config.logoScan.matcherTimeoutMs,
      stdoutPrefix: "[logo-template-matching]",
      stderrPrefix: "[logo-template-matching]",
    });
    const outJson = path.join(cwd, "output", "ads", `${channelId}.json`);
    const raw = await fs.readFile(outJson, "utf8");
    const data = JSON.parse(raw);
    console.log(
      `[logo-scan] STAGE logo-template-matching DONE ${label}${scope} ` +
        `scanned_s=${data.scanned_duration_seconds ?? "?"} ad_segments=${(data.ad_segments || []).length}`,
    );
    const pdt = data.media_timeline_zero_epoch_utc;
    const mediaTimelineZeroEpochUtc =
      pdt != null && Number.isFinite(Number(pdt)) ? Number(pdt) : null;
    return {
      ad_segments: data.ad_segments || [],
      scanned_duration_seconds: data.scanned_duration_seconds ?? 0,
      mediaTimelineZeroEpochUtc,
    };
  } catch (e) {
    console.error(`[logo-scan] STAGE logo-template-matching FAILED ${label}${scope}: ${e.message}`);
    return null;
  }
}

/**
 * Single-frame probe: local path or image URL + channel_id. Parses JSON from stdout.
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function runProbeTemplateMatch(framePathOrUrl, channelId) {
  const bin = config.logoScan.logoMatcherBin;
  const cwd = config.logoScan.logoMatcherDir;
  if (!(await fileExists(bin))) {
    console.error(`[logo-live] Missing binary: ${bin} (build logo-template-matching)`);
    return null;
  }
  const detectorOutputDir = path.join(config.logoScan.logoDetectorDir, "output");
  const args = [
    framePathOrUrl,
    channelId,
    "--detector-output",
    detectorOutputDir,
    "--threshold",
    String(config.logoScan.matcherMatchThreshold),
    "--search-pad-frac",
    String(config.logoScan.matcherSearchPadFrac),
  ];
  try {
    const { stdout, stderr } = await runExecutable(bin, args, {
      cwd,
      timeoutMs: config.logoLiveMatching.probeTimeoutMs,
      stdoutPrefix: null,
      stderrPrefix: "[logo-template-matching]",
    });
    if (stderr && process.env.LOGO_LIVE_DEBUG === "true") {
      console.error(stderr.slice(-2000));
    }
    const raw = stdout.trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      console.error(`[logo-live] probe: no JSON in stdout for channel=${channelId}`);
      return null;
    }
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    console.error(`[logo-live] probe failed channel=${channelId}: ${e.message}`);
    return null;
  }
}
