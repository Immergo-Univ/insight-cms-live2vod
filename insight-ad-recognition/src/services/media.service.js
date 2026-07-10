/**
 * Extracts a SINGLE frame (the LAST one) from a resolved input.
 *
 * The CMS always posts a trimmed archive window (startTime/endTime already embedded in the URL),
 * so we treat the input as the VOD it is and keep the last decoded frame. ffmpeg's `-update 1`
 * trick makes a single output file that is overwritten by every decoded frame, so the file ends
 * up holding the LAST frame of the tail window. No audio is extracted anymore.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { run } from "../utils/exec.js";
import { resolveInput } from "./m3u8.service.js";

// Our HLS demuxer may reference https segments from a local playlist; ffmpeg blocks non-whitelisted
// protocols by default, so enable the ones we actually use.
const HLS_PROTOCOL_ARGS = [
  "-protocol_whitelist",
  "file,crypto,data,http,https,tcp,tls",
  "-allowed_extensions",
  "ALL",
];

const HTTP_ARGS = [
  "-user_agent",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "-rw_timeout",
  "20000000",
];

/**
 * Extract the last frame of the (trimmed) input into `workDir/last.jpg`.
 *
 * @param {string} videoUrl
 * @param {string} workDir
 * @returns {Promise<{ framePath: string, isLive: boolean, inputMeta: object }>}
 */
export async function extractLastFrame(videoUrl, workDir) {
  const { ffmpegInput, kind, isLive, meta } = await resolveInput(videoUrl, workDir);

  const framePath = path.join(workDir, "last.jpg");
  const tail = config.frame.tailSeconds;

  const isHls = kind === "hls";
  const isHttp = /^https?:\/\//i.test(ffmpegInput);
  const protocolArgs = isHls ? HLS_PROTOCOL_ARGS : [];
  const httpArgs = isHttp ? HTTP_ARGS : [];

  // The CMS sends a single-instant window (startTime == endTime), so a VOD/archive input is a
  // single segment (~one GOP). We decode ONLY keyframes (`-skip_frame nokey`) and keep the last one
  // (`-update 1`) — minimal decode, mostly I/O. Live HLS still reads the tail from the live edge.
  const seekArgs = isHls && isLive ? ["-live_start_index", "-1"] : [];
  const durationArgs = isHls && isLive ? ["-t", String(tail)] : [];

  const buildArgs = (decodeArgs) => [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    ...httpArgs,
    ...protocolArgs,
    ...seekArgs,
    ...decodeArgs,
    "-i",
    ffmpegInput,
    ...durationArgs,
    "-map",
    "0:v:0?",
    "-an",
    "-q:v",
    "2",
    "-update",
    "1",
    "-y",
    framePath,
  ];

  // 1) Keyframe-only pass (cheapest): keep the last keyframe.
  await run(config.tools.ffmpeg, buildArgs(["-skip_frame", "nokey"]), {
    timeoutMs: config.limits.requestTimeoutMs,
  }).catch(() => null);

  // 2) Fallback: if no keyframe was emitted, decode all frames and keep the last one.
  if (!(await fileNonEmpty(framePath))) {
    await run(config.tools.ffmpeg, buildArgs([]), {
      timeoutMs: config.limits.requestTimeoutMs,
    }).catch(() => null);
  }

  if (!(await fileNonEmpty(framePath))) {
    throw new Error("ffmpeg produced no frame");
  }

  return {
    framePath,
    isLive,
    inputMeta: { kind, ...meta },
  };
}

async function fileNonEmpty(p) {
  try {
    const st = await fs.stat(p);
    return st.size >= 128;
  } catch {
    return false;
  }
}

function parseFps(v) {
  if (!v || typeof v !== "string") return null;
  const [a, b] = v.split("/").map(Number);
  if (!Number.isFinite(a) || a === 0) return null;
  const f = b ? a / b : a;
  return Number.isFinite(f) ? Math.round(f * 100) / 100 : null;
}

/**
 * Probe the stream's base video resolution + frame rate with ffprobe (no frame extraction).
 * @param {string} videoUrl
 * @returns {Promise<{ width: number|null, height: number|null, fps: number|null, duration: number|null }>}
 */
export async function probeStream(videoUrl) {
  const { ffmpegInput, kind } = await resolveInput(videoUrl, null);
  const isHls = kind === "hls";
  const isHttp = /^https?:\/\//i.test(ffmpegInput);

  const args = [
    "-v",
    "error",
    ...(isHttp ? HTTP_ARGS : []),
    ...(isHls ? HLS_PROTOCOL_ARGS : []),
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate,avg_frame_rate",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    ffmpegInput,
  ];

  const res = await run(config.tools.ffprobe, args, { timeoutMs: config.limits.requestTimeoutMs });
  let parsed = {};
  try {
    parsed = JSON.parse(res.stdout || "{}");
  } catch {
    parsed = {};
  }
  const st = (Array.isArray(parsed.streams) && parsed.streams[0]) || {};
  const duration =
    parsed.format && Number.isFinite(Number(parsed.format.duration))
      ? Math.round(Number(parsed.format.duration) * 100) / 100
      : null;
  return {
    width: Number.isFinite(Number(st.width)) ? Number(st.width) : null,
    height: Number.isFinite(Number(st.height)) ? Number(st.height) : null,
    fps: parseFps(st.r_frame_rate) || parseFps(st.avg_frame_rate) || null,
    duration,
  };
}

export default { extractLastFrame, probeStream };
