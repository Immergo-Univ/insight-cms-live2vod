/**
 * Burn editor clip widgets (text + image) into encoded video using ffmpeg filter_complex.
 * Each widget is materialized as a transparent PNG (text via headless HTML, images via sharp)
 * and composited with overlay only — no ffmpeg text filters.
 *
 * Layout is normalized 0–1 in the same space as the editor: full frame, or 9:16 strip after crop.
 */

import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { isValidEditorPosterId, loadEditorPosterBuffer } from "./editor-posters.service.js";
import { renderTextWidgetToPng } from "./vod-widget-html2png.service.js";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * Extract editor poster UUID from `/api/channels/.../editor/posters/{id}/file` path.
 * @param {string} pathname
 * @returns {string | null}
 */
function posterIdFromEditorApiPath(pathname) {
  const m = String(pathname || "").match(/^\/api\/channels\/[^/]+\/editor\/posters\/([^/]+)(?:\/file)?$/i);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  return isValidEditorPosterId(id) ? id : null;
}

/**
 * Copy widget image bytes to a temp PNG for ffmpeg `-i` (disk, editor poster API path, or http(s)).
 *
 * @param {{ src?: string, storedRelative?: string }} imageWidget
 * @param {string} destPngPath absolute path ending in .png
 * @returns {Promise<string>} absolute path written (.png)
 */
export async function materializeWidgetImageForFfmpeg(imageWidget, destPngPath) {
  const srcRaw = typeof imageWidget.src === "string" ? imageWidget.src.trim() : "";
  const storedRelative =
    typeof imageWidget.storedRelative === "string" ? imageWidget.storedRelative.trim() : "";

  const src =
    srcRaw.startsWith("/") || /^https?:\/\//i.test(srcRaw) ? srcRaw : srcRaw ? `/${srcRaw}` : "";

  /** @type {Buffer | null} */
  let buf = null;

  if (storedRelative) {
    const rel = storedRelative.replace(/^\/+/, "");
    if (rel.startsWith("posters/")) {
      const abs = path.join(config.editorPosters.dataDir, rel);
      try {
        buf = await fs.readFile(abs);
      } catch {
        /* missing on disk — try poster id + S3 */
      }
      if (!buf) {
        const idMatch = rel.match(/^posters\/([0-9a-f-]{36})\.[^/.]+$/i);
        if (idMatch && isValidEditorPosterId(idMatch[1])) {
          const loaded = await loadEditorPosterBuffer(idMatch[1]);
          if (loaded) {
            buf = loaded.buffer;
          }
        }
      }
    }
  }

  if (!buf && src.startsWith("/")) {
    const posterId = posterIdFromEditorApiPath(src.split("?")[0] || "");
    if (posterId) {
      const loaded = await loadEditorPosterBuffer(posterId);
      if (loaded) {
        buf = loaded.buffer;
      }
    }
  }

  if (!buf && /^https?:\/\//i.test(src)) {
    try {
      const u = new URL(src);
      const posterId = posterIdFromEditorApiPath(u.pathname);
      if (posterId) {
        const loaded = await loadEditorPosterBuffer(posterId);
        if (loaded) {
          buf = loaded.buffer;
        }
      }
    } catch {
      /* not a valid URL */
    }
  }

  if (!buf && /^https?:\/\//i.test(src)) {
    const res = await fetch(src, {
      redirect: "follow",
      headers: {
        ...(process.env.VOD_WIDGET_IMAGE_FETCH_UA
          ? { "User-Agent": process.env.VOD_WIDGET_IMAGE_FETCH_UA }
          : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Widget image download failed ${res.status}: ${src.slice(0, 120)}`);
    }
    buf = Buffer.from(await res.arrayBuffer());
  }

  if (!buf || buf.length === 0) {
    throw new Error(
      `Widget image not found: use editor poster disk path (storedRelative), same-origin /api/.../editor/posters/{uuid}/file, or http(s). src=${src.slice(0, 160)} storedRelative=${storedRelative.slice(0, 80)}`,
    );
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`Widget image too large (>${MAX_IMAGE_BYTES} bytes)`);
  }

  const out = destPngPath.replace(/\.[^/.]+$/, "") + ".png";
  const sharp = (await import("sharp")).default;
  await sharp(buf).ensureAlpha().png().toFile(out);
  return out;
}

/**
 * Escape path for use inside ffmpeg filter string single-quoted segments.
 * @param {string} p
 */
export function escapePathForFfmpegFilter(p) {
  return String(p).replace(/\\/g, "/").replace(/'/g, "\\'");
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function evenPositive(n) {
  let x = Math.max(2, Math.round(Number(n) || 0));
  if (x % 2 !== 0) x -= 1;
  return Math.max(2, x);
}

/**
 * Scale + pad widget PNG into the target box (contain, transparent letterbox).
 * Uses fast_bilinear instead of lanczos; no leading format=rgba — PNG inputs already carry alpha.
 *
 * @param {number} inputIdx ffmpeg extra input index
 * @param {number} Pw even target width
 * @param {number} Ph even target height
 * @param {string} imgLabel filter pad output label
 */
function widgetPngScalePadFilter(inputIdx, Pw, Ph, imgLabel) {
  return `[${inputIdx}:v]scale=w=${Pw}:h=${Ph}:flags=fast_bilinear:force_original_aspect_ratio=decrease,pad=${Pw}:${Ph}:(ow-iw)/2:(oh-ih)/2:color=0x00000000[${imgLabel}]`;
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 */
function clampNum(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Local [0, segmentLen) timeline inside ffmpeg after `-ss start -to end` (t restarts at 0 per segment).
 *
 * @param {object} p
 * @param {number} p.clipStart parent-timeline Mark In of this output clip
 * @param {number} p.clipEnd parent-timeline Mark Out
 * @param {number} p.segmentStart parent-timeline start of this encode slice
 * @param {number} p.segmentEnd parent-timeline end of this encode slice
 * @param {number} [p.offsetIn] seconds from clip start (default 0)
 * @param {number} [p.offsetOut] seconds from clip start, exclusive end (default = clip length)
 * @returns {{ t0: number, t1: number } | null} null = widget not visible in this segment
 */
function widgetEnableWindowInSegment(p) {
  const cs = Number(p.clipStart);
  const ce = Number(p.clipEnd);
  const s = Number(p.segmentStart);
  const e = Number(p.segmentEnd);
  if (![cs, ce, s, e].every((x) => Number.isFinite(x)) || ce <= cs || e <= s) return null;
  const clipLen = ce - cs;
  const segLen = e - s;
  if (clipLen <= 0 || segLen <= 0) return null;

  let oi = p.offsetIn;
  let oo = p.offsetOut;
  if (!Number.isFinite(Number(oi))) oi = 0;
  if (!Number.isFinite(Number(oo))) oo = clipLen;
  oi = clampNum(oi, 0, clipLen);
  oo = clampNum(oo, oi, clipLen);

  const parentOn = cs + oi;
  const parentOff = cs + oo;
  const overlap0 = Math.max(s, parentOn);
  const overlap1 = Math.min(e, parentOff);
  if (overlap1 <= overlap0) return null;

  const t0 = overlap0 - s;
  const t1 = overlap1 - s;
  const t0c = clampNum(t0, 0, segLen);
  const t1c = clampNum(t1, 0, segLen);
  if (t1c <= t0c) return null;
  return { t0: t0c, t1: t1c };
}

/**
 * Build filter_complex fragment: video on [0:v] → optional crop → chain widget PNG overlays → [outv].
 *
 * @param {object} opts
 * @param {string | null} opts.cropFilter e.g. crop=608:1080:656:0 (no brackets)
 * @param {number} opts.outW output (even) width after crop
 * @param {number} opts.outH output height after crop
 * @param {unknown[]} opts.widgets
 * @param {string} opts.workDir
 * @param {string} opts.tag unique prefix for temp files
 * @param {import("playwright").Browser | undefined} opts.renderBrowser required when any widget is text
 * @param {number} [opts.clipStart] parent-timeline Mark In for this clip (widget offsets are relative to this)
 * @param {number} [opts.clipEnd] parent-timeline Mark Out
 * @param {number} [opts.segmentStart] parent-timeline start of this encode slice
 * @param {number} [opts.segmentEnd] parent-timeline end of this encode slice
 * @returns {Promise<{ filterComplex: string, extraInputs: string[], tempFiles: string[] }>}
 */
export async function buildWidgetOverlayFilterComplex(opts) {
  const {
    cropFilter,
    outW,
    outH,
    widgets,
    workDir,
    tag,
    renderBrowser,
    clipStart,
    clipEnd,
    segmentStart,
    segmentEnd,
  } = opts;
  const W = outW;
  const H = outH;
  const segS = Number(segmentStart);
  const segE = Number(segmentEnd);
  const cs = Number(clipStart);
  const ce = Number(clipEnd);
  const timingEnabled =
    [segS, segE, cs, ce].every((x) => Number.isFinite(x)) && ce > cs && segE > segS;
  const segLen = timingEnabled ? segE - segS : 0;
  /** @type {string[]} */
  const tempFiles = [];

  if (!Array.isArray(widgets) || widgets.length === 0) {
    return { filterComplex: "", extraInputs: [], tempFiles: [] };
  }

  const hasText = widgets.some((w) => w && typeof w === "object" && w.kind === "text");
  if (hasText && !renderBrowser) {
    throw new Error("Widget text rendering requires renderBrowser (Chromium) — internal encoder error");
  }

  /** @type {string[]} */
  const parts = [];
  /** @type {string[]} */
  const extraInputs = [];
  let chain = cropFilter ? `[0:v]${cropFilter}[w0]` : `[0:v]null[w0]`;
  parts.push(chain);
  let last = "w0";
  let inputIdx = 1;
  let wgt = 0;

  try {
    for (const raw of widgets) {
      if (!raw || typeof raw !== "object") continue;
      const kind = raw.kind;
      const layout = raw.layout;
      if (!layout || typeof layout !== "object") continue;
      const lx = clamp(Number(layout.x), 0, 1);
      const ly = clamp(Number(layout.y), 0, 1);
      const lw = clamp(Number(layout.w), 0.01, 1);
      const lh = clamp(Number(layout.h), 0.01, 1);

      const px = Math.round(lx * W);
      const py = Math.round(ly * H);
      const Pw = evenPositive(lw * W);
      const Ph = evenPositive(lh * H);

      /** @type {string} */
      let enableOpt = "";
      if (timingEnabled) {
        const win = widgetEnableWindowInSegment({
          clipStart: cs,
          clipEnd: ce,
          segmentStart: segS,
          segmentEnd: segE,
          offsetIn: raw.offsetIn,
          offsetOut: raw.offsetOut,
        });
        if (!win) continue;
        const fmt = (x) => String(Number(x.toFixed(6)));
        const eps = 1e-3;
        const fullWindow = win.t0 <= eps && win.t1 >= segLen - eps;
        if (!fullWindow) {
          const t1c = Math.min(win.t1, segLen);
          enableOpt = `:enable='gte(t,${fmt(win.t0)})*lt(t,${fmt(t1c)})'`;
        }
      }

      if (kind === "text") {
        /** @type {import("playwright").Browser} */
        const browser = /** @type {import("playwright").Browser} */ (renderBrowser);
        const html = typeof raw.html === "string" ? raw.html : "";
        const fontSizePx = clamp(Number(raw.fontSizePx) || 28, 8, 120);
        const color = typeof raw.color === "string" ? raw.color : "#ffffff";
        const pngPath = path.join(workDir, `widget_text_${tag}_${wgt}.png`);
        await renderTextWidgetToPng({
          browser,
          html,
          color,
          fontSizePx,
          viewportH: H,
          boxW: Pw,
          boxH: Ph,
          destPath: pngPath,
        });
        tempFiles.push(pngPath);
        extraInputs.push(pngPath);
        const imgLabel = `im${inputIdx}`;
        const outLabel = `wtx${wgt}`;
        parts.push(widgetPngScalePadFilter(inputIdx, Pw, Ph, imgLabel));
        parts.push(`[${last}][${imgLabel}]overlay=${px}:${py}:format=auto${enableOpt}[${outLabel}]`);
        last = outLabel;
        inputIdx += 1;
        wgt += 1;
      } else if (kind === "image") {
        const src = typeof raw.src === "string" ? raw.src.trim() : "";
        const sr = typeof raw.storedRelative === "string" ? raw.storedRelative.trim() : "";
        if (!src && !sr) continue;
        const imgPath = path.join(workDir, `widget_img_${tag}_${inputIdx}.png`);
        const written = await materializeWidgetImageForFfmpeg(raw, imgPath);
        tempFiles.push(written);
        extraInputs.push(written);
        const imgLabel = `im${inputIdx}`;
        const outLabel = `wim${inputIdx}`;
        parts.push(widgetPngScalePadFilter(inputIdx, Pw, Ph, imgLabel));
        parts.push(`[${last}][${imgLabel}]overlay=${px}:${py}:format=auto${enableOpt}[${outLabel}]`);
        last = outLabel;
        inputIdx += 1;
      }
    }

    if (extraInputs.length === 0) {
      for (const f of tempFiles) {
        await fs.unlink(f).catch(() => {});
      }
      return { filterComplex: "", extraInputs: [], tempFiles: [] };
    }

    parts.push(`[${last}]format=yuv420p[outv]`);
    return {
      filterComplex: parts.join(";"),
      extraInputs,
      tempFiles,
    };
  } catch (e) {
    await Promise.all(tempFiles.map((f) => fs.unlink(f).catch(() => {})));
    throw e;
  }
}
