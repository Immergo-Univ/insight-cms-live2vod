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

  // Primary strategy: seek near the end and keep the last decoded frame.
  //  - Live HLS: start at the last segment and read the tail window.
  //  - VOD HLS / file: seek `tail` seconds before EOF.
  const primarySeek = isHls && isLive ? ["-live_start_index", "-1"] : ["-sseof", `-${tail}`];
  const primaryDuration = isHls && isLive ? ["-t", String(tail)] : [];

  const buildArgs = (seekArgs, durationArgs) => [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    ...httpArgs,
    ...protocolArgs,
    ...seekArgs,
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

  await run(config.tools.ffmpeg, buildArgs(primarySeek, primaryDuration), {
    timeoutMs: config.limits.requestTimeoutMs,
  }).catch(() => null);

  // Fallback: some short/edge clips reject `-sseof`; decode from the start and keep the last frame.
  if (!(await fileNonEmpty(framePath)) && !(isHls && isLive)) {
    await run(config.tools.ffmpeg, buildArgs([], []), {
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

export default { extractLastFrame };
