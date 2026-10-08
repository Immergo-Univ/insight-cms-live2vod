/**
 * Package an already-encoded MP4 (video + one or more audio tracks) into an HLS VOD asset
 * with selectable alternate audio renditions (EXT-X-MEDIA:TYPE=AUDIO).
 *
 * Codecs are copied (no re-encode): the muxed dubbed MP4 already carries AAC audio tracks.
 * This is the encoder-lite equivalent of the immergo concat/HLS step, but preserving every
 * audio track instead of collapsing to a single one.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { spawnFailureMessage } from "../utils/spawn-failure-message.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";

/** Target HLS segment duration (seconds). */
const HLS_SEGMENT_SEC = 6;

/**
 * Best-effort ISO 639-1 → display name for the audio rendition NAME attribute.
 * Falls back to the uppercased code.
 * @param {string} code
 * @returns {string}
 */
export function audioLanguageDisplayName(code) {
  const map = {
    en: "English",
    es: "Spanish",
    he: "Hebrew",
    ar: "Arabic",
    fr: "French",
    de: "German",
    pt: "Portuguese",
    it: "Italian",
    ru: "Russian",
    ja: "Japanese",
    zh: "Chinese",
    hi: "Hindi",
    tr: "Turkish",
    pl: "Polish",
    uk: "Ukrainian",
    nl: "Dutch",
  };
  const c = String(code || "").trim().toLowerCase();
  return map[c] || (c ? c.toUpperCase() : "Audio");
}

/**
 * @param {string[]} args
 * @param {() => boolean} [shouldCancel]
 * @returns {Promise<void>}
 */
function runFfmpeg(args, shouldCancel) {
  return new Promise((resolve, reject) => {
    if (shouldCancel?.()) {
      reject(new Error("CANCELLED"));
      return;
    }
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 256000) stderr = stderr.slice(-200000);
    });
    const check = setInterval(() => {
      if (shouldCancel?.()) {
        clearInterval(check);
        proc.kill("SIGKILL");
      }
    }, 400);
    proc.on("error", (err) => {
      clearInterval(check);
      if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
        reject(new Error("ffmpeg not found on PATH"));
        return;
      }
      reject(err);
    });
    proc.on("close", (code, signal) => {
      clearInterval(check);
      if (shouldCancel?.()) {
        reject(new Error("CANCELLED"));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const msg = spawnFailureMessage({
        commandLabel: "ffmpeg",
        code: code ?? null,
        signal: signal ?? null,
        stderr,
      });
      reject(new Error(msg.length > 800 ? `${msg.slice(0, 800)}…` : msg));
    });
  });
}

/**
 * @typedef {object} HlsAudioTrack
 * @property {string} lang ISO 639-1 (or "und" for the original).
 * @property {string} [name] Display name for the audio rendition.
 * @property {boolean} [default] Whether this rendition is the HLS default/autoselect.
 */

/**
 * Build the `-var_stream_map` value: one video variant plus one audio rendition per track,
 * all attached to a single audio group so players expose an audio-language selector.
 *
 * @param {HlsAudioTrack[]} audioTracks
 * @returns {string}
 */
function buildVarStreamMap(audioTracks) {
  const groupId = "aud";
  const entries = [`v:0,agroup:${groupId},name:video`];
  audioTracks.forEach((t, i) => {
    const lang = String(t.lang || "und").trim().toLowerCase() || "und";
    const name = (t.name || audioLanguageDisplayName(lang)).replace(/[",\s]+/g, "_");
    const parts = [`a:${i}`, `agroup:${groupId}`, `language:${lang}`, `name:${name}`];
    if (t.default) {
      // Note: ffmpeg's -var_stream_map only accepts `default` here (not `autoselect`).
      parts.push("default:yes");
    }
    entries.push(parts.join(","));
  });
  return entries.join(" ");
}

/**
 * Package `inputMp4` into an HLS VOD tree under `outDir` with alternate audio renditions.
 *
 * Layout produced:
 *   outDir/master.m3u8
 *   outDir/stream_0/{playlist.m3u8,init.mp4,seg_*.m4s}   (video)
 *   outDir/stream_1/{...}                                (audio track 0 — original)
 *   outDir/stream_2/{...}                                (audio track 1 — dub)
 *
 * @param {object} opts
 * @param {string} opts.inputMp4 Source MP4 (video + N audio tracks, in order).
 * @param {HlsAudioTrack[]} opts.audioTracks Audio track descriptors, index-aligned to the MP4 audio streams.
 * @param {string} opts.outDir Output directory (created if missing).
 * @param {() => boolean} [opts.shouldCancel]
 * @param {string} [opts.logPrefix]
 * @returns {Promise<{ masterPath: string, dir: string }>}
 */
export async function packageMp4ToHls(opts) {
  const { inputMp4, audioTracks, outDir, shouldCancel, logPrefix } = opts;
  if (!Array.isArray(audioTracks) || audioTracks.length === 0) {
    throw new Error("packageMp4ToHls requires at least one audio track");
  }
  await fs.mkdir(outDir, { recursive: true });

  const maps = ["-map", "0:v:0"];
  for (let i = 0; i < audioTracks.length; i++) {
    maps.push("-map", `0:a:${i}`);
  }

  const varStreamMap = buildVarStreamMap(audioTracks);
  const masterName = "master.m3u8";

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputMp4,
    ...maps,
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-f",
    "hls",
    "-hls_time",
    String(HLS_SEGMENT_SEC),
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-master_pl_name",
    masterName,
    "-var_stream_map",
    varStreamMap,
    "-hls_segment_filename",
    path.join(outDir, "stream_%v", "seg_%d.m4s"),
    path.join(outDir, "stream_%v", "playlist.m3u8"),
  ];

  vodEncodeStdout(
    logPrefix || "hls",
    `packaging HLS multi-audio tracks=${audioTracks.length} map='${varStreamMap}' out=${outDir}`,
  );
  await runFfmpeg(args, shouldCancel);

  const masterPath = path.join(outDir, masterName);
  return { masterPath, dir: outDir };
}
