/**
 * Local VOD encoder using ffmpeg. This module is the default implementation behind
 * `runVodEncodeJob` — swap it for a remote transcoding API adapter in production if needed.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

/** Minimum kept segment duration (seconds). */
const MIN_SEGMENT_SEC = 0.08;

/**
 * @param {number} clipStart
 * @param {number} clipEnd
 * @param {Array<{ startTime: number, endTime: number }>} ads
 * @returns {Array<[number, number]>}
 */
export function subtractAdsFromInterval(clipStart, clipEnd, ads) {
  const overlapping = (ads || [])
    .map((ad) => ({
      lo: Math.max(clipStart, Number(ad.startTime)),
      hi: Math.min(clipEnd, Number(ad.endTime)),
    }))
    .filter((seg) => seg.hi > seg.lo)
    .sort((a, b) => a.lo - b.lo);

  const merged = [];
  for (const seg of overlapping) {
    if (!merged.length || seg.lo > merged[merged.length - 1].hi) {
      merged.push({ lo: seg.lo, hi: seg.hi });
    } else {
      merged[merged.length - 1].hi = Math.max(merged[merged.length - 1].hi, seg.hi);
    }
  }

  /** @type {Array<[number, number]>} */
  const parts = [];
  let cur = clipStart;
  for (const ad of merged) {
    if (ad.lo > cur && ad.lo - cur >= MIN_SEGMENT_SEC) {
      parts.push([cur, ad.lo]);
    }
    cur = Math.max(cur, ad.hi);
  }
  if (clipEnd - cur >= MIN_SEGMENT_SEC) {
    parts.push([cur, clipEnd]);
  }
  return parts;
}

/**
 * @param {object} opts
 * @param {string} opts.inputUrl
 * @param {number} opts.start
 * @param {number} opts.end
 * @param {string} opts.outputPath
 * @param {() => boolean} opts.shouldCancel
 */
function runFfmpegSegment(opts) {
  const { inputUrl, start, end, outputPath, shouldCancel } = opts;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputUrl,
    "-ss",
    String(start),
    "-to",
    String(end),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ];
  return runFfmpeg(args, shouldCancel);
}

/**
 * @param {object} opts
 * @param {string} opts.listPath
 * @param {string} opts.outputPath
 * @param {() => boolean} opts.shouldCancel
 */
function runFfmpegConcat(opts) {
  const { listPath, outputPath, shouldCancel } = opts;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath,
  ];
  return runFfmpeg(args, shouldCancel);
}

/**
 * @param {string[]} args
 * @param {() => boolean} shouldCancel
 */
function runFfmpeg(args, shouldCancel) {
  return new Promise((resolve, reject) => {
    if (shouldCancel()) {
      reject(new Error("CANCELLED"));
      return;
    }
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const check = setInterval(() => {
      if (shouldCancel()) {
        clearInterval(check);
        proc.kill("SIGKILL");
      }
    }, 400);
    proc.on("error", (err) => {
      clearInterval(check);
      if (err.code === "ENOENT") {
        reject(new Error("ffmpeg not found on PATH"));
        return;
      }
      reject(err);
    });
    proc.on("close", (code) => {
      clearInterval(check);
      if (shouldCancel()) {
        reject(new Error("CANCELLED"));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

/**
 * @typedef {object} EditorEncodeSpec
 * @property {string} clipUrl
 * @property {Array<{ order: number, startTime: number, endTime: number }>} clips
 * @property {Array<{ startTime: number, endTime: number }>} [ads]
 */

/**
 * Builds one MP4 from ordered clips, removing ad windows inside each clip (times relative to clipUrl).
 *
 * @param {object} ctx
 * @param {EditorEncodeSpec} ctx.spec
 * @param {string} ctx.workDir
 * @param {(pct: number) => void} [ctx.onProgress] 0–90 during encode
 * @param {() => boolean} ctx.shouldCancel
 * @returns {Promise<{ localPath: string }>}
 */
export async function encodeEditorJsonToMp4(ctx) {
  const { spec, workDir, onProgress, shouldCancel } = ctx;
  const clipUrl = spec.clipUrl;
  if (!clipUrl) throw new Error("Missing clipUrl in spec");

  await fs.mkdir(workDir, { recursive: true });

  const ads = spec.ads || [];
  const clipsSorted = [...(spec.clips || [])].sort((a, b) => a.order - b.order);

  /** @type {Array<{ start: number, end: number }>} */
  const allParts = [];
  for (const clip of clipsSorted) {
    const parts = subtractAdsFromInterval(
      Number(clip.startTime),
      Number(clip.endTime),
      ads,
    );
    for (const [s, e] of parts) {
      allParts.push({ start: s, end: e });
    }
  }

  if (allParts.length === 0) {
    throw new Error("No segments to encode after applying clips and ad removal");
  }

  const totalSteps = allParts.length + 1;
  const segmentFiles = [];

  for (let i = 0; i < allParts.length; i++) {
    if (shouldCancel()) throw new Error("CANCELLED");
    const { start, end } = allParts[i];
    const out = path.join(workDir, `seg_${i}.mp4`);
    await runFfmpegSegment({
      inputUrl: clipUrl,
      start,
      end,
      outputPath: out,
      shouldCancel,
    });
    segmentFiles.push(out);
    onProgress?.(Math.min(90, Math.round(((i + 1) / totalSteps) * 90)));
  }

  if (shouldCancel()) throw new Error("CANCELLED");

  const listPath = path.join(workDir, "concat.txt");
  const lines = segmentFiles.map((f) => {
    const abs = path.resolve(f);
    const escaped = abs.replace(/'/g, `'\\''`);
    return `file '${escaped}'`;
  });
  await fs.writeFile(listPath, `${lines.join("\n")}\n`, "utf8");

  const outputPath = path.join(workDir, "output.mp4");
  try {
    await runFfmpegConcat({ listPath, outputPath, shouldCancel });
  } catch (e) {
    await runFfmpeg(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      shouldCancel,
    );
  }

  onProgress?.(90);
  return { localPath: outputPath };
}
