/**
 * Extracts the analysis window from a resolved input:
 *  - N frames (1 per second by default) as JPEGs — for SigLIP/OCR/overlays + the mosaic preview.
 *  - A 16 kHz mono WAV used for whisper.cpp transcription + local audio metrics (RMS/silence/music).
 *
 * For HLS we point ffmpeg at the local live-edge playlist and take the LAST `SEGMENT_SECONDS`
 * seconds so the capture matches "the end of the video" (live edge). For files we take the
 * first `SEGMENT_SECONDS` seconds.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { run } from "../utils/exec.js";
import { resolveInput } from "./m3u8.service.js";

// Our local edge.m3u8 (file protocol) references remote https segments. ffmpeg's HLS demuxer
// blocks non-whitelisted protocols by default, so enable the ones we actually use.
const HLS_PROTOCOL_ARGS = [
  "-protocol_whitelist",
  "file,crypto,data,http,https,tcp,tls",
  "-allowed_extensions",
  "ALL",
];

async function listFrames(framesDir) {
  const entries = await fs.readdir(framesDir);
  return entries
    .filter((f) => /^frame_\d+\.jpg$/i.test(f))
    .sort()
    .map((f) => path.join(framesDir, f));
}

/**
 * @param {string} videoUrl
 * @param {string} workDir
 * @returns {Promise<{
 *   framePaths: string[],
 *   audioWhisperPath: string | null,
 *   durationSec: number,
 *   isLive: boolean,
 *   inputMeta: object
 * }>}
 */
export async function extractWindow(videoUrl, workDir) {
  const { ffmpegInput, kind, isLive, meta } = await resolveInput(videoUrl, workDir);

  const framesDir = path.join(workDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const framePattern = path.join(framesDir, "frame_%03d.jpg");
  const audioWhisperPath = path.join(workDir, "audio_whisper.wav");

  const seconds = config.segment.seconds;
  const fps = config.segment.fps;

  const isHls = kind === "hls";
  const isHttp = /^https?:\/\//i.test(ffmpegInput);

  // HLS demuxer options (protocol whitelist + allow query-string segment names).
  const protocolArgs = isHls ? HLS_PROTOCOL_ARGS : [];

  // http-only options; invalid when the input is a local file (would raise "Option not found").
  const httpArgs = isHttp
    ? [
        "-user_agent",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-rw_timeout",
        "20000000",
      ]
    : [];

  // Live edge selection:
  //  - Live HLS  → start at the last segment (`-live_start_index -1`).
  //  - VOD HLS   → seek from the end of the media (`-sseof -seconds`).
  //  - File      → analyze from the start.
  let seekArgs = [];
  if (isHls && isLive) {
    seekArgs = ["-live_start_index", "-1"];
  } else if (isHls && !isLive) {
    seekArgs = ["-sseof", `-${seconds}`];
  }

  // Single ffmpeg invocation producing frames + a 16 kHz mono WAV (whisper + audio metrics).
  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    ...httpArgs,
    ...protocolArgs,
    ...seekArgs,
    "-i",
    ffmpegInput,
    "-t",
    String(seconds),
    // Video → 1 frame per second (SigLIP/OCR/overlays + debug mosaic).
    "-map",
    "0:v:0?",
    "-vf",
    `fps=${fps}`,
    "-frames:v",
    String(seconds * fps),
    "-q:v",
    "3",
    framePattern,
    // Audio → 16 kHz mono PCM (whisper.cpp + ffmpeg astats/silencedetect metrics).
    "-map",
    "0:a:0?",
    "-t",
    String(seconds),
    "-ac",
    "1",
    "-ar",
    String(config.audio.whisperSampleRate),
    "-c:a",
    "pcm_s16le",
    audioWhisperPath,
  ];

  const res = await run(config.tools.ffmpeg, args, { timeoutMs: config.limits.requestTimeoutMs });

  const framePaths = await listFrames(framesDir);
  if (framePaths.length === 0) {
    throw new Error(`ffmpeg produced no frames (code=${res.code}): ${(res.stderr || "").slice(-500)}`);
  }

  // Validate the audio output — an empty/tiny file means the source had no audio track.
  const finalWhisper = (await fileNonEmpty(audioWhisperPath)) ? audioWhisperPath : null;

  const durationSec = framePaths.length / fps;

  return {
    framePaths,
    audioWhisperPath: finalWhisper,
    durationSec,
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

export default { extractWindow };
