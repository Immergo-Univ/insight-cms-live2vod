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
 * @param {string} inputUrl
 * @returns {string[]}
 */
function ffmpegInputGlobalArgs(inputUrl) {
  const out = [];
  if (!/^https?:\/\//i.test(String(inputUrl || ""))) return out;
  out.push("-protocol_whitelist", "file,http,https,tcp,tls,crypto,subfile");
  const ua = (
    process.env.VOD_FFMPEG_USER_AGENT ||
    process.env.VOD_FFPROBE_USER_AGENT ||
    process.env.LOGO_DETECTOR_FFMPEG_UA ||
    ""
  ).trim();
  if (ua) out.push("-user_agent", ua);
  return out;
}

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
 * Pick coded width/height from ffprobe JSON (largest video area if several streams).
 * @param {unknown} json
 * @returns {{ width: number, height: number } | null}
 */
function pickVideoDimensionsFromFfprobeJson(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.streams)) return null;
  /** @type {Array<{ width?: number, height?: number, codec_type?: string }>} */
  const streams = json.streams;
  const videos = streams.filter(
    (s) =>
      s &&
      s.codec_type === "video" &&
      Number.isFinite(Number(s.width)) &&
      Number.isFinite(Number(s.height)) &&
      Number(s.width) >= 2 &&
      Number(s.height) >= 2,
  );
  if (videos.length === 0) return null;
  videos.sort(
    (a, b) => Number(b.width) * Number(b.height) - Number(a.width) * Number(a.height),
  );
  return { width: Number(videos[0].width), height: Number(videos[0].height) };
}

/**
 * ffprobe CSV output can be a single line or multiple lines (e.g. some HLS inputs).
 * @param {string} stdout
 * @returns {{ width: number, height: number } | null}
 */
function parseFfprobeWxH(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^(\d+)x(\d+)$/) || line.match(/^(\d+),(\d+)$/);
    if (!m) continue;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (Number.isFinite(w) && Number.isFinite(h) && w >= 2 && h >= 2) {
      return { width: w, height: h };
    }
  }
  return null;
}

/**
 * HLS / CDN: default ffprobe often returns no video or N/A without enough analyze time
 * or without protocol_whitelist. JSON + largest video stream is more reliable than csv v:0 alone.
 *
 * @param {string} inputUrl
 * @returns {Promise<{ width: number, height: number }>}
 */
async function runFfprobeVideoSize(inputUrl) {
  const common = [
    "-hide_banner",
    "-v",
    "error",
    "-analyzeduration",
    "20000000",
    "-probesize",
    "50000000",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto,subfile",
  ];
  const ua = (process.env.VOD_FFPROBE_USER_AGENT || process.env.LOGO_DETECTOR_FFMPEG_UA || "").trim();
  if (ua) {
    common.push("-user_agent", ua);
  }

  const runProbe = (extraArgs) =>
    new Promise((resolve, reject) => {
      const proc = spawn("ffprobe", [...common, ...extraArgs, inputUrl], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", (err) => {
        if (err && /** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
          reject(new Error("ffprobe not found on PATH (required for vertical crop)"));
          return;
        }
        reject(err);
      });
      proc.on("close", (code) => {
        if (code !== 0) {
          const errText = stderr.trim() || `ffprobe exited with code ${code}`;
          console.error(
            "[vod][ffprobe]",
            errText.length > 4000 ? `${errText.slice(0, 4000)}…` : errText,
          );
          reject(new Error(errText));
          return;
        }
        resolve({ stdout, stderr });
      });
    });

  let firstErr = "";
  try {
    const { stdout } = await runProbe(["-show_streams", "-print_format", "json"]);
    const json = JSON.parse(stdout);
    const dims = pickVideoDimensionsFromFfprobeJson(json);
    if (dims) return dims;
    firstErr = "no video stream with width/height in ffprobe JSON";
  } catch (e) {
    firstErr = e instanceof Error ? e.message : String(e);
  }

  try {
    const { stdout } = await runProbe([
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
    ]);
    const parsed = parseFfprobeWxH(stdout);
    if (parsed) return parsed;
    firstErr = `${firstErr}; csv unparsed: ${JSON.stringify(stdout.trim().slice(0, 160))}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`vertical crop: ffprobe failed (${msg}). JSON attempt: ${firstErr}`);
  }

  throw new Error(`vertical crop: ffprobe could not read video dimensions (${firstErr})`);
}

/**
 * Full-frame height, width = height×9/16, horizontal position by centerX (0–1).
 * YUV420 requires even width/height.
 *
 * @param {number} iw
 * @param {number} ih
 * @param {number} centerXNorm
 */
export function computeNineSixteenStripCrop(iw, ih, centerXNorm) {
  const cx = Math.min(1, Math.max(0, Number(centerXNorm)));
  let cropH = ih % 2 === 0 ? ih : ih - 1;
  if (cropH < 2) cropH = ih;
  let cropW = Math.round((cropH * 9) / 16);
  cropW -= cropW % 2;
  if (cropW < 2) {
    throw new Error("Invalid vertical crop width");
  }
  if (cropW > iw) {
    throw new Error("Video is too narrow for a full-height 9:16 crop");
  }
  let cropX = Math.round(cx * iw - cropW / 2);
  cropX -= cropX % 2;
  cropX = Math.max(0, Math.min(cropX, iw - cropW));
  const cropY = 0;
  return { cropW, cropH, cropX, cropY };
}

/**
 * @param {object} opts
 * @param {string} opts.inputUrl
 * @param {number} opts.start
 * @param {number} opts.end
 * @param {string} opts.outputPath
 * @param {() => boolean} opts.shouldCancel
 * @param {string} [opts.videoFilter] e.g. crop=w:h:x:y
 */
function runFfmpegSegment(opts) {
  const { inputUrl, start, end, outputPath, shouldCancel, videoFilter } = opts;
  const vfArgs = videoFilter ? ["-vf", videoFilter] : [];
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...ffmpegInputGlobalArgs(inputUrl),
    "-i",
    inputUrl,
    "-ss",
    String(start),
    "-to",
    String(end),
    ...vfArgs,
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
      else {
        const tail = stderr.trim() || "(no stderr output)";
        console.error(`[vod][ffmpeg] exit=${code}`, tail.length > 4000 ? `${tail.slice(0, 4000)}…` : tail);
        reject(new Error(tail.length > 800 ? `${tail.slice(0, 800)}…` : tail || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

/**
 * @typedef {object} EditorEncodeSpec
 * @property {string} clipUrl
 * @property {Array<{ order: number, startTime: number, endTime: number }>} clips
 * @property {Array<{ startTime: number, endTime: number }>} [ads]
 * @property {{ aspectRatio: string, centerX: number }} [cropWindow]
 * @property {{ enabled: boolean, style?: { fontSizePx?: number, textColor?: string, outlineColor?: string, outlineWidthPx?: number } }} [subtitles]
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

  let videoFilter = null;
  const cropWin = spec.cropWindow;
  const centerXNum = cropWin ? Number(cropWin.centerX) : NaN;
  if (cropWin && cropWin.aspectRatio === "9:16" && Number.isFinite(centerXNum)) {
    const { width: iw, height: ih } = await runFfprobeVideoSize(clipUrl);
    const { cropW, cropH, cropX, cropY } = computeNineSixteenStripCrop(iw, ih, centerXNum);
    videoFilter = `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
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
      videoFilter: videoFilter ?? undefined,
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
