/**
 * Local VOD encoder using ffmpeg. This module is the default implementation behind
 * `runVodEncodeJob` — swap it for a remote transcoding API adapter in production if needed.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";
import { widgetRenderBrowserRef, widgetRenderBrowserUnref } from "./vod-widget-html2png.service.js";
import { buildWidgetOverlayFilterComplex } from "./vod-widget-overlay.service.js";

/** Minimum kept segment duration (seconds). */
const MIN_SEGMENT_SEC = 0.08;

/** libx264 CRF (higher = lower quality / smaller output). */
const VOD_LIBX264_CRF = 28;

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
/**
 * Encode one time slice; burns clip widgets (text/image) when `clip.widgets` is non-empty.
 *
 * @param {object} opts
 * @param {unknown} opts.clip
 * @param {EditorEncodeSpec} opts.spec
 * @param {number} opts.iw
 * @param {number} opts.ih
 * @param {string} opts.workDir
 * @param {string} opts.segmentTag
 * @param {string} [opts.encodeLogPrefix]
 */
async function runFfmpegSegmentWithOptionalWidgets(opts) {
  const {
    inputUrl,
    start,
    end,
    outputPath,
    shouldCancel,
    videoFilter,
    clip,
    spec,
    iw,
    ih,
    workDir,
    segmentTag,
    encodeLogPrefix,
  } = opts;

  const widgets = clip?.widgets;
  const hasWidgets = Array.isArray(widgets) && widgets.length > 0;
  const needsTextBrowser =
    hasWidgets &&
    widgets.some((w) => w && typeof w === "object" && w.kind === "text");

  vodEncodeStdout(
    encodeLogPrefix || "encode",
    `segment start tag=${segmentTag} t=${start}-${end}s widgets=${hasWidgets ? widgets.length : 0} crop=${videoFilter ? "yes" : "no"}`,
  );

  if (!hasWidgets) {
    await runFfmpegSegment({
      inputUrl,
      start,
      end,
      outputPath,
      shouldCancel,
      videoFilter: videoFilter || undefined,
    });
    vodEncodeStdout(encodeLogPrefix || "encode", `segment ok tag=${segmentTag} path=${outputPath}`);
    return;
  }

  /** @type {import("playwright").Browser | undefined} */
  let renderBrowser;
  if (needsTextBrowser) {
    renderBrowser = await widgetRenderBrowserRef();
  }

  let cropFilter = videoFilter || null;
  let outW = iw % 2 === 0 ? iw : iw - 1;
  let outH = ih % 2 === 0 ? ih : ih - 1;
  if (videoFilter) {
    const cropWin = clip?.cropWindow ?? spec.cropWindow;
    const centerXNum = cropWin ? Number(cropWin.centerX) : NaN;
    if (cropWin && cropWin.aspectRatio === "9:16" && Number.isFinite(centerXNum)) {
      const { cropW, cropH } = computeNineSixteenStripCrop(iw, ih, centerXNum);
      outW = cropW;
      outH = cropH;
    }
  }

  /** @type {string[]} */
  let tempFiles = [];
  try {
    const { filterComplex, extraInputs, tempFiles: tf } = await buildWidgetOverlayFilterComplex({
      cropFilter,
      outW,
      outH,
      widgets,
      workDir,
      tag: segmentTag,
      renderBrowser,
    });
    tempFiles = tf;

    if (!filterComplex || extraInputs.length === 0) {
      await runFfmpegSegment({
        inputUrl,
        start,
        end,
        outputPath,
        shouldCancel,
        videoFilter: videoFilter || undefined,
      });
      vodEncodeStdout(
        encodeLogPrefix || "encode",
        `segment ok tag=${segmentTag} path=${outputPath} widgets=skipped(no drawable overlays)`,
      );
      return;
    }

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...ffmpegInputGlobalArgs(inputUrl),
      "-ss",
      String(start),
      "-to",
      String(end),
      "-i",
      inputUrl,
      ...extraInputs.flatMap((p) => ["-i", p]),
      "-filter_complex",
      filterComplex,
      "-map",
      "[outv]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      String(VOD_LIBX264_CRF),
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

    await runFfmpeg(args, shouldCancel);
    vodEncodeStdout(
      encodeLogPrefix || "encode",
      `segment ok tag=${segmentTag} path=${outputPath} extraInputs=${extraInputs.length}`,
    );
  } finally {
    await Promise.all(tempFiles.map((f) => fs.unlink(f).catch(() => {})));
    if (needsTextBrowser) {
      await widgetRenderBrowserUnref();
    }
  }
}

function runFfmpegSegment(opts) {
  const { inputUrl, start, end, outputPath, shouldCancel, videoFilter } = opts;
  const vfArgs = videoFilter ? ["-vf", videoFilter] : [];
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...ffmpegInputGlobalArgs(inputUrl),
    "-ss",
    String(start),
    "-to",
    String(end),
    "-i",
    inputUrl,
    ...vfArgs,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    String(VOD_LIBX264_CRF),
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
        vodEncodeStdout(
          `ffmpeg exit=${code}`,
          tail.length > 4000 ? `${tail.slice(0, 4000)}…` : tail,
        );
        reject(new Error(tail.length > 800 ? `${tail.slice(0, 800)}…` : tail || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

/**
 * @typedef {object} EditorEncodeSpec
 * @property {string} clipUrl
 * @property {Array<{ order: number, startTime: number, endTime: number, metadata?: { title?: string, description?: string, tags?: string }, posters?: unknown[], cropWindow?: { aspectRatio: string, centerX: number }, subtitles?: { enabled: boolean, whisperSourceLanguage?: string, whisperOutputLanguage?: string, languageMode?: string, style?: { fontSizePx?: number, textColor?: string, outlineColor?: string, outlineWidthPx?: number } }, widgets?: unknown[] }>} clips
 * @property {Array<{ startTime: number, endTime: number }>} [ads]
 * @property {{ aspectRatio: string, centerX: number }} [cropWindow] legacy: applies to all clips if clips[].cropWindow missing
 * @property {{ enabled: boolean, whisperSourceLanguage?: string, whisperOutputLanguage?: string, languageMode?: string, style?: { fontSizePx?: number, textColor?: string, outlineColor?: string, outlineWidthPx?: number } }} [subtitles] legacy: applies to all clips if clips[].subtitles missing
 */

/**
 * One MP4 per entry in `spec.clips` (sorted by `order`). Ad windows are cut inside each clip's [startTime,endTime] (times relative to clipUrl).
 *
 * @param {object} ctx
 * @param {EditorEncodeSpec} ctx.spec
 * @param {string} ctx.workDir
 * @param {(pct: number) => void} [ctx.onProgress] 0–90 during encode
 * @param {() => boolean} ctx.shouldCancel
 * @param {string} [ctx.encodeLogPrefix] prefix for stdout lines (e.g. job=uuid)
 * @returns {Promise<{ localPaths: string[], localPath: string }>}
 */
export async function encodeEditorJsonToMp4(ctx) {
  const { spec, workDir, onProgress, shouldCancel, encodeLogPrefix } = ctx;
  const logP = encodeLogPrefix || "encode";
  const clipUrl = spec.clipUrl;
  if (!clipUrl) throw new Error("Missing clipUrl in spec");

  await fs.mkdir(workDir, { recursive: true });

  const ads = spec.ads || [];
  const clipsSorted = [...(spec.clips || [])].sort((a, b) => a.order - b.order);
  if (clipsSorted.length === 0) throw new Error("No clips in spec");

  let totalParts = 0;
  for (const clip of clipsSorted) {
    const parts = subtractAdsFromInterval(Number(clip.startTime), Number(clip.endTime), ads);
    totalParts += parts.length;
  }
  if (totalParts === 0) {
    throw new Error("No segments to encode after applying clips and ad removal");
  }

  vodEncodeStdout(
    logP,
    `plan clips=${clipsSorted.length} playableSegments=${totalParts} ads=${(ads || []).length}`,
  );

  vodEncodeStdout(logP, "ffprobe source dimensions…");
  const { width: iw, height: ih } = await runFfprobeVideoSize(clipUrl);
  vodEncodeStdout(logP, `source video ${iw}x${ih}`);

  /**
   * @param {unknown} clip
   * @returns {string | null}
   */
  function videoFilterForClip(clip) {
    const cropWin = clip?.cropWindow ?? spec.cropWindow;
    const centerXNum = cropWin ? Number(cropWin.centerX) : NaN;
    if (cropWin && cropWin.aspectRatio === "9:16" && Number.isFinite(centerXNum)) {
      const { cropW, cropH, cropX, cropY } = computeNineSixteenStripCrop(iw, ih, centerXNum);
      return `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
    }
    return null;
  }

  let doneParts = 0;
  /** @type {string[]} */
  const clipOutputPaths = [];

  for (let ci = 0; ci < clipsSorted.length; ci++) {
    const clip = clipsSorted[ci];
    const videoFilter = videoFilterForClip(clip);
    const parts = subtractAdsFromInterval(Number(clip.startTime), Number(clip.endTime), ads);
    if (parts.length === 0) {
      throw new Error(`Clip order ${clip.order} has no playable segments after ad removal`);
    }
    const clipOut = path.join(workDir, `clip_order_${clip.order}.mp4`);
    const widgetN = Array.isArray(clip?.widgets) ? clip.widgets.length : 0;
    vodEncodeStdout(
      logP,
      `clip order=${clip.order} ci=${ci} segments=${parts.length} widgets=${widgetN} out=${clipOut}`,
    );

    if (parts.length === 1) {
      if (shouldCancel()) throw new Error("CANCELLED");
      const [s, e] = parts[0];
      await runFfmpegSegmentWithOptionalWidgets({
        inputUrl: clipUrl,
        start: s,
        end: e,
        outputPath: clipOut,
        shouldCancel,
        videoFilter: videoFilter || undefined,
        clip,
        spec,
        iw,
        ih,
        workDir,
        segmentTag: `c${ci}_p0`,
        encodeLogPrefix: logP,
      });
      doneParts += 1;
      onProgress?.(Math.min(90, Math.round((doneParts / totalParts) * 90)));
    } else {
      const segmentFiles = [];
      for (let i = 0; i < parts.length; i++) {
        if (shouldCancel()) throw new Error("CANCELLED");
        const [s, e] = parts[i];
        const segPath = path.join(workDir, `c${ci}_seg_${i}.mp4`);
        await runFfmpegSegmentWithOptionalWidgets({
          inputUrl: clipUrl,
          start: s,
          end: e,
          outputPath: segPath,
          shouldCancel,
          videoFilter: videoFilter || undefined,
          clip,
          spec,
          iw,
          ih,
          workDir,
          segmentTag: `c${ci}_s${i}`,
          encodeLogPrefix: logP,
        });
        segmentFiles.push(segPath);
        doneParts += 1;
        onProgress?.(Math.min(90, Math.round((doneParts / totalParts) * 90)));
      }
      const listPath = path.join(workDir, `concat_${ci}.txt`);
      const lines = segmentFiles.map((f) => {
        const abs = path.resolve(f);
        const escaped = abs.replace(/'/g, `'\\''`);
        return `file '${escaped}'`;
      });
      await fs.writeFile(listPath, `${lines.join("\n")}\n`, "utf8");
      vodEncodeStdout(logP, `concat clip order=${clip.order} files=${segmentFiles.length} -> ${clipOut}`);
      try {
        await runFfmpegConcat({ listPath, outputPath: clipOut, shouldCancel });
      } catch {
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
            "-crf",
            String(VOD_LIBX264_CRF),
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
            clipOut,
          ],
          shouldCancel,
        );
      }
    }
    clipOutputPaths.push(clipOut);
  }

  onProgress?.(90);
  return { localPaths: clipOutputPaths, localPath: clipOutputPaths[0] };
}
