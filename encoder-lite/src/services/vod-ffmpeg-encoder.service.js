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

/** Min interval between ffmpeg-driven progress callbacks (aligned with backend tick). */
const FFMPEG_PROGRESS_EMIT_MS = 1000;

/**
 * Extra `-i` paths for widget filter_complex; animated GIF uses `-stream_loop -1` before its `-i`.
 * @param {Array<string | { path: string, streamLoop?: boolean }>} extraInputs
 * @returns {string[]}
 */
function ffmpegWidgetExtraInputArgs(extraInputs) {
  return extraInputs.flatMap((entry) => {
    if (typeof entry === "string") return ["-i", entry];
    const pre = entry.streamLoop ? ["-stream_loop", "-1"] : [];
    return [...pre, "-i", entry.path];
  });
}

/**
 * Best-effort: max encoded timestamp (seconds) from ffmpeg stderr (key `time=`).
 * @param {string} chunk
 * @returns {number | null}
 */
function parseMaxTimeSecondsFromFfmpegStderr(chunk) {
  let best = null;
  const re = /time=(\d+):(\d+):(\d+\.?\d*)/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const sec = parseFloat(m[3]);
    const t = h * 3600 + min * 60 + sec;
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best;
}

/**
 * When parsing stderr for `time=`, ffmpeg must not use `-loglevel error` only.
 * @param {string[]} args
 * @returns {string[]}
 */
function ffmpegArgsWithProgressableStderr(args) {
  const out = [...args];
  const i = out.indexOf("-loglevel");
  if (i >= 0 && out[i + 1] === "error") {
    out[i + 1] = "info";
  } else if (i < 0) {
    const hi = out.indexOf("-hide_banner");
    if (hi >= 0) out.splice(hi + 1, 0, "-loglevel", "info");
    else out.unshift("-loglevel", "info");
  }
  return out;
}

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

function clamp01Encoder(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.min(1, Math.max(0, x));
}

/**
 * @param {unknown} b
 * @returns {{ timeSeconds: number, centerX: number } | null}
 */
function parseVerticalCropBp(b) {
  if (!b || typeof b !== "object") return null;
  const timeSeconds = Number(b.timeSeconds);
  const centerX = Number(b.centerX);
  if (!Number.isFinite(timeSeconds) || !Number.isFinite(centerX)) return null;
  return { timeSeconds, centerX: clamp01Encoder(centerX) };
}

/**
 * Sorted keyframes relative to clip start; null = use static cropWindow only.
 * @param {unknown} clip
 * @param {number} fallbackCenterX
 * @returns {Array<{ timeSeconds: number, centerX: number }> | null}
 */
function normalizedVerticalCropBreakpointsForEncoder(clip, fallbackCenterX) {
  const raw = clip?.verticalCropBreakpoints;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const clipStart = Number(clip?.startTime);
  const clipEnd = Number(clip?.endTime);
  const dur = Math.max(0, clipEnd - clipStart);
  const fb = clamp01Encoder(fallbackCenterX);
  /** @type {Array<{ timeSeconds: number, centerX: number }>} */
  const list = [];
  for (const item of raw) {
    const p = parseVerticalCropBp(item);
    if (p) list.push({ timeSeconds: Math.min(dur, Math.max(0, p.timeSeconds)), centerX: p.centerX });
  }
  if (list.length === 0) return null;
  list.sort((a, b) => a.timeSeconds - b.timeSeconds);
  /** @type {Array<{ timeSeconds: number, centerX: number }>} */
  const dedup = [];
  for (const p of list) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.timeSeconds - p.timeSeconds) < 1e-4) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  if (dedup[0].timeSeconds > 1e-4) {
    dedup.unshift({ timeSeconds: 0, centerX: fb });
    const d2 = [];
    for (const p of dedup) {
      const last = d2[d2.length - 1];
      if (last && Math.abs(last.timeSeconds - p.timeSeconds) < 1e-4) d2[d2.length - 1] = p;
      else d2.push(p);
    }
    dedup.length = 0;
    dedup.push(...d2);
  }
  if (dedup.length <= 1) return null;
  return dedup;
}

/**
 * @param {Array<{ timeSeconds: number, centerX: number }>} sortedBps
 * @param {number} localT
 * @param {number} fallbackCx
 */
function centerXAtLocalEncoder(sortedBps, localT, fallbackCx) {
  const t = Number.isFinite(localT) ? localT : 0;
  let cx = clamp01Encoder(fallbackCx);
  for (const bp of sortedBps) {
    if (bp.timeSeconds <= t + 1e-9) cx = bp.centerX;
    else break;
  }
  return cx;
}

/**
 * @param {number} u
 * @param {string} easing
 */
function applyVerticalCropPanEasingEncoder(u, easing) {
  const x = Math.min(1, Math.max(0, u));
  if (easing === "linear") return x;
  return x * x * (3 - 2 * x);
}

/**
 * @param {Array<{ timeSeconds: number, centerX: number }>} bps
 * @param {number} localT
 * @param {number} fallbackCx
 * @param {string} easing
 */
function centerXSmoothAtLocalEncoder(bps, localT, fallbackCx, easing) {
  const t = Number.isFinite(localT) ? localT : 0;
  if (!bps || bps.length === 0) return clamp01Encoder(fallbackCx);
  const first = bps[0];
  const last = bps[bps.length - 1];
  if (t <= first.timeSeconds + 1e-9) return first.centerX;
  if (t >= last.timeSeconds - 1e-9) return last.centerX;
  for (let i = 0; i < bps.length - 1; i++) {
    const a = bps[i];
    const b = bps[i + 1];
    if (t <= b.timeSeconds + 1e-9) {
      const span = b.timeSeconds - a.timeSeconds;
      if (span < 1e-9) return b.centerX;
      const rawU = (t - a.timeSeconds) / span;
      const u = applyVerticalCropPanEasingEncoder(rawU, easing);
      return clamp01Encoder(a.centerX + (b.centerX - a.centerX) * u);
    }
  }
  return last.centerX;
}

/**
 * @param {unknown} raw
 * @returns {{ mode: string, easing: string, motionSampleSec: number }}
 */
function normalizeVerticalCropPanSettingsEncoder(raw) {
  const mode = raw && typeof raw === "object" && raw.mode === "smooth" ? "smooth" : "step";
  const easing =
    raw && typeof raw === "object" && raw.easing === "linear" ? "linear" : "ease-in-out";
  let motionSampleSec = raw && typeof raw === "object" ? Number(raw.motionSampleSec) : NaN;
  if (!Number.isFinite(motionSampleSec)) motionSampleSec = 0.12;
  motionSampleSec = Math.min(2, Math.max(0.03, motionSampleSec));
  return { mode, easing, motionSampleSec };
}

/**
 * Subdivide one ad-free [partStart, partEnd] by vertical crop keyframes (step or smooth centerX).
 * @param {unknown} clip
 * @param {unknown} spec
 * @param {number} iw
 * @param {number} ih
 * @param {number} partStart
 * @param {number} partEnd
 * @returns {Array<{ start: number, end: number, videoFilter: string | null, cropCenterX: number | null }>}
 */
function buildVerticalAwareSlices(clip, spec, iw, ih, partStart, partEnd) {
  const cropWin = clip?.cropWindow ?? spec.cropWindow;
  const fallbackCx = cropWin && Number.isFinite(Number(cropWin.centerX)) ? Number(cropWin.centerX) : 0.5;
  const hasVertical =
    cropWin && cropWin.aspectRatio === "9:16" && Number.isFinite(Number(cropWin.centerX));
  if (!hasVertical) {
    return [{ start: partStart, end: partEnd, videoFilter: null, cropCenterX: null }];
  }

  const bps = normalizedVerticalCropBreakpointsForEncoder(clip, fallbackCx);
  if (!bps) {
    const { cropW, cropH, cropX, cropY } = computeNineSixteenStripCrop(iw, ih, fallbackCx);
    return [
      {
        start: partStart,
        end: partEnd,
        videoFilter: `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
        cropCenterX: fallbackCx,
      },
    ];
  }

  const pan = normalizeVerticalCropPanSettingsEncoder(clip?.verticalCropPanSettings);
  const clipStart = Number(clip.startTime);

  /** @type {number[]} */
  let points;
  if (pan.mode === "smooth") {
    const pointSet = new Set([partStart, partEnd]);
    for (const bp of bps) {
      const pt = clipStart + bp.timeSeconds;
      if (pt > partStart + 1e-4 && pt < partEnd - 1e-4) pointSet.add(pt);
    }
    let g = partStart;
    while (g < partEnd - 1e-6) {
      g += pan.motionSampleSec;
      if (g < partEnd - 1e-6) pointSet.add(Math.min(g, partEnd));
    }
    points = [...pointSet].sort((a, b) => a - b);
  } else {
    const inner = [];
    for (const bp of bps) {
      const pt = clipStart + bp.timeSeconds;
      if (pt > partStart + 1e-4 && pt < partEnd - 1e-4) inner.push(pt);
    }
    inner.sort((a, b) => a - b);
    points = [partStart, ...inner, partEnd];
  }

  /** @type {Array<{ start: number, end: number, videoFilter: string, cropCenterX: number }>} */
  const raw = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b - a < 1e-4) continue;
    let cx;
    if (pan.mode === "smooth") {
      const midLocal = (a + b) / 2 - clipStart;
      cx = centerXSmoothAtLocalEncoder(bps, midLocal, fallbackCx, pan.easing);
    } else {
      const localAtA = a - clipStart;
      cx = centerXAtLocalEncoder(bps, localAtA, fallbackCx);
    }
    const { cropW, cropH, cropX, cropY } = computeNineSixteenStripCrop(iw, ih, cx);
    raw.push({
      start: a,
      end: b,
      videoFilter: `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
      cropCenterX: cx,
    });
  }
  /** @type {Array<{ start: number, end: number, videoFilter: string, cropCenterX: number }>} */
  const merged = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.videoFilter === seg.videoFilter) last.end = seg.end;
    else merged.push({ ...seg });
  }
  if (merged.length === 0) {
    const { cropW, cropH, cropX, cropY } = computeNineSixteenStripCrop(iw, ih, fallbackCx);
    return [
      {
        start: partStart,
        end: partEnd,
        videoFilter: `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
        cropCenterX: fallbackCx,
      },
    ];
  }
  return merged;
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
    tenantId = "",
    jobId = "",
    onSegmentFraction,
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
      onSegmentFraction,
    });
    vodEncodeStdout(encodeLogPrefix || "encode", `segment ok tag=${segmentTag} path=${outputPath}`);
    return;
  }

  /** @type {import("playwright").Browser | undefined} */
  let renderBrowser;
  if (needsTextBrowser) {
    vodEncodeStdout(
      encodeLogPrefix || "encode",
      "widgets: acquiring Chromium (Playwright) for text overlays…",
    );
    renderBrowser = await widgetRenderBrowserRef();
    vodEncodeStdout(encodeLogPrefix || "encode", "widgets: Chromium ready");
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
      clipStart: Number(clip?.startTime),
      clipEnd: Number(clip?.endTime),
      segmentStart: start,
      segmentEnd: end,
      encodeLogPrefix: encodeLogPrefix || "encode",
      tenantId,
      jobId,
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
        onSegmentFraction,
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
      ...ffmpegWidgetExtraInputArgs(extraInputs),
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

    const dur = Number(end) - Number(start);
    const pOpts =
      onSegmentFraction && dur > 0
        ? { segmentDurationSec: dur, onSegmentFraction }
        : undefined;
    await runFfmpeg(args, shouldCancel, pOpts);
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
  const { inputUrl, start, end, outputPath, shouldCancel, videoFilter, onSegmentFraction } = opts;
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
  const dur = Number(end) - Number(start);
  const pOpts =
    onSegmentFraction && dur > 0 ? { segmentDurationSec: dur, onSegmentFraction } : undefined;
  return runFfmpeg(args, shouldCancel, pOpts);
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
 * @typedef {object} FfmpegProgressOpts
 * @property {number} segmentDurationSec
 * @property {(fraction0to1: number) => void} onSegmentFraction
 */

/**
 * @param {string[]} args
 * @param {() => boolean} shouldCancel
 * @param {FfmpegProgressOpts | undefined} [progressOpts]
 */
function runFfmpeg(args, shouldCancel, progressOpts) {
  return new Promise((resolve, reject) => {
    if (shouldCancel()) {
      reject(new Error("CANCELLED"));
      return;
    }
    const useProgress =
      Boolean(progressOpts?.onSegmentFraction) &&
      Number(progressOpts?.segmentDurationSec) > 0;
    const ffArgs = useProgress ? ffmpegArgsWithProgressableStderr(args) : args;
    const proc = spawn("ffmpeg", ffArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      const piece = chunk.toString();
      stderr += piece;
      if (stderr.length > 256000) stderr = stderr.slice(-200000);
      if (useProgress && progressOpts) {
        const dur = Number(progressOpts.segmentDurationSec);
        const tail = stderr.slice(-65536);
        const t = parseMaxTimeSecondsFromFfmpegStderr(tail);
        if (t != null && dur > 0) {
          const frac = Math.min(1, Math.max(0, t / dur));
          progressOpts.onSegmentFraction(frac);
        }
      }
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
 * @property {Array<{ order: number, startTime: number, endTime: number, metadata?: { title?: string, description?: string, tags?: string[] }, posters?: unknown[], cropWindow?: { aspectRatio: string, centerX: number }, verticalCropBreakpoints?: Array<{ id?: string, timeSeconds: number, centerX: number }>, verticalCropPanSettings?: { mode?: string, easing?: string, motionSampleSec?: number }, subtitles?: { enabled: boolean, whisperSourceLanguage?: string, whisperOutputLanguage?: string, languageMode?: string, style?: { fontSizePx?: number, textColor?: string, outlineColor?: string, outlineWidthPx?: number } }, widgets?: unknown[] }>} clips
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
  const { spec, workDir, onProgress, shouldCancel, encodeLogPrefix, tenantId = "", jobId = "" } = ctx;
  const logP = encodeLogPrefix || "encode";
  const clipUrl = spec.clipUrl;
  if (!clipUrl) throw new Error("Missing clipUrl in spec");

  await fs.mkdir(workDir, { recursive: true });

  const ads = spec.ads || [];
  const clipsSorted = [...(spec.clips || [])].sort((a, b) => a.order - b.order);
  if (clipsSorted.length === 0) throw new Error("No clips in spec");

  vodEncodeStdout(logP, "ffprobe source dimensions…");
  const { width: iw, height: ih } = await runFfprobeVideoSize(clipUrl);
  vodEncodeStdout(logP, `source video ${iw}x${ih}`);

  let totalParts = 0;
  for (const clip of clipsSorted) {
    const parts = subtractAdsFromInterval(Number(clip.startTime), Number(clip.endTime), ads);
    for (const [s, e] of parts) {
      const slices = buildVerticalAwareSlices(clip, spec, iw, ih, s, e);
      totalParts += slices.length;
    }
  }
  if (totalParts === 0) {
    throw new Error("No segments to encode after applying clips and ad removal");
  }

  vodEncodeStdout(
    logP,
    `plan clips=${clipsSorted.length} playableSegments=${totalParts} ads=${(ads || []).length}`,
  );

  let doneParts = 0;
  /** @type {string[]} */
  const clipOutputPaths = [];

  /**
   * Maps ffmpeg segment completion 0–1 into overall encode progress 0–90.
   * Throttled to ~1/s so stderr parsing does not flood the job snapshot.
   * @param {number} doneBeforeThisSegment
   */
  function makeSegmentFractionEmitter(doneBeforeThisSegment) {
    let lastAt = 0;
    return (frac) => {
      const now = Date.now();
      const clamped = Math.min(1, Math.max(0, frac));
      if (now - lastAt < FFMPEG_PROGRESS_EMIT_MS && clamped < 0.999) return;
      lastAt = now;
      const p = Math.min(90, ((doneBeforeThisSegment + clamped) / totalParts) * 90);
      onProgress?.(p);
    };
  }

  for (let ci = 0; ci < clipsSorted.length; ci++) {
    const clip = clipsSorted[ci];
    const parts = subtractAdsFromInterval(Number(clip.startTime), Number(clip.endTime), ads);
    if (parts.length === 0) {
      throw new Error(`Clip order ${clip.order} has no playable segments after ad removal`);
    }
    const clipOut = path.join(workDir, `clip_order_${clip.order}.mp4`);
    const widgetN = Array.isArray(clip?.widgets) ? clip.widgets.length : 0;
    vodEncodeStdout(
      logP,
      `clip order=${clip.order} ci=${ci} adParts=${parts.length} widgets=${widgetN} out=${clipOut}`,
    );

    /** @type {string[]} */
    const piecePaths = [];
    for (let pi = 0; pi < parts.length; pi++) {
      const [s, e] = parts[pi];
      const slices = buildVerticalAwareSlices(clip, spec, iw, ih, s, e);
      for (let vi = 0; vi < slices.length; vi++) {
        if (shouldCancel()) throw new Error("CANCELLED");
        const sl = slices[vi];
        const piecePath = path.join(workDir, `c${ci}_p${pi}_v${vi}.mp4`);
        const baseCw = clip?.cropWindow ?? spec?.cropWindow;
        const clipPayload =
          sl.cropCenterX != null && baseCw
            ? { ...clip, cropWindow: { ...baseCw, aspectRatio: "9:16", centerX: sl.cropCenterX } }
            : clip;
        await runFfmpegSegmentWithOptionalWidgets({
          inputUrl: clipUrl,
          start: sl.start,
          end: sl.end,
          outputPath: piecePath,
          shouldCancel,
          videoFilter: sl.videoFilter || undefined,
          clip: clipPayload,
          spec,
          iw,
          ih,
          workDir,
          segmentTag: `c${ci}_p${pi}_v${vi}`,
          encodeLogPrefix: logP,
          tenantId,
          jobId,
          onSegmentFraction: makeSegmentFractionEmitter(doneParts),
        });
        piecePaths.push(piecePath);
        doneParts += 1;
        onProgress?.(Math.min(90, Math.round((doneParts / totalParts) * 90)));
      }
    }

    if (piecePaths.length === 1) {
      await fs.copyFile(piecePaths[0], clipOut);
      await fs.unlink(piecePaths[0]).catch(() => {});
    } else {
      const listPath = path.join(workDir, `concat_${ci}.txt`);
      const lines = piecePaths.map((f) => {
        const abs = path.resolve(f);
        const escaped = abs.replace(/'/g, `'\\''`);
        return `file '${escaped}'`;
      });
      await fs.writeFile(listPath, `${lines.join("\n")}\n`, "utf8");
      vodEncodeStdout(logP, `concat clip order=${clip.order} files=${piecePaths.length} -> ${clipOut}`);
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
      for (const f of piecePaths) {
        await fs.unlink(f).catch(() => {});
      }
    }
    clipOutputPaths.push(clipOut);
  }

  onProgress?.(90);
  return { localPaths: clipOutputPaths, localPath: clipOutputPaths[0] };
}
