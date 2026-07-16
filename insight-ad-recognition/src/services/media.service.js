/**
 * Extracts a SINGLE frame (the LAST keyframe) from a resolved input.
 *
 * The CMS posts a trimmed archive window (`endTime = startTime + ~10s` embedded in the URL).
 * We decode keyframes only and keep the last one via ffmpeg `-skip_frame nokey` + `-update 1`.
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

  // The CMS posts a short archive window (typically endTime = startTime + 10s). We decode ONLY
  // keyframes (`-skip_frame nokey`) and keep the LAST one (`-update 1`). Live HLS still reads the
  // tail from the live edge.
  const seekArgs = isHls && isLive ? ["-live_start_index", "-1"] : [];
  const durationArgs = isHls && isLive ? ["-t", String(tail)] : [];

  const buildArgs = (decodeArgs) => [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    // Bound the initial stream probing so ffmpeg doesn't read/parse more of the .ts than needed.
    "-analyzeduration",
    "2000000",
    "-probesize",
    "3000000",
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

  // 1) Keyframe-only pass: always keep the last keyframe of the window.
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

/**
 * Extract frames across the WHOLE window at `fps` (for the boundary-polish scan). Unlike
 * extractLastFrame, this decodes the full range so intermediate (non-keyframe) moments are covered,
 * giving sub-segment (frame-level) resolution. Returns the frame paths (chronological) + the media
 * epoch of the first frame (from EXT-X-PROGRAM-DATE-TIME when available, else the URL's startTime).
 *
 * @param {string} videoUrl
 * @param {string} workDir
 * @param {{ fps?: number, maxFrames?: number }} [opts]
 * @returns {Promise<{ framePaths: string[], anchorEpoch: number|null, fps: number }>}
 */
export async function extractFrames(videoUrl, workDir, opts = {}) {
  const fps = Math.max(1, Number(opts.fps) || 4);
  const maxFrames = Math.max(1, Number(opts.maxFrames) || 1200);

  const { ffmpegInput, kind, meta } = await resolveInput(videoUrl, null, { allowDirectSegment: false });
  const isHls = kind === "hls";
  const isHttp = /^https?:\/\//i.test(ffmpegInput);
  const protocolArgs = isHls ? HLS_PROTOCOL_ARGS : [];
  const httpArgs = isHttp ? HTTP_ARGS : [];

  const framesDir = path.join(workDir, "scan");
  await fs.mkdir(framesDir, { recursive: true });
  const pattern = path.join(framesDir, "f_%05d.jpg");

  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    ...httpArgs,
    ...protocolArgs,
    "-i",
    ffmpegInput,
    "-an",
    "-vf",
    `fps=${fps}`,
    "-frames:v",
    String(maxFrames),
    "-q:v",
    "3",
    "-y",
    pattern,
  ];

  await run(config.tools.ffmpeg, args, { timeoutMs: config.limits.requestTimeoutMs }).catch(() => null);

  const entries = await fs.readdir(framesDir).catch(() => []);
  const framePaths = entries
    .filter((f) => /^f_\d+\.jpg$/i.test(f))
    .sort()
    .map((f) => path.join(framesDir, f));

  let anchorEpoch = Number.isFinite(meta?.firstProgramDateEpoch) ? meta.firstProgramDateEpoch : null;
  if (anchorEpoch == null) {
    try {
      const v = new URL(videoUrl).searchParams.get("startTime");
      const n = v != null ? parseInt(v, 10) : NaN;
      if (Number.isFinite(n)) anchorEpoch = n;
    } catch {
      /* no anchor */
    }
  }

  return { framePaths, anchorEpoch, fps };
}

export default { extractLastFrame, probeStream, extractFrames };
