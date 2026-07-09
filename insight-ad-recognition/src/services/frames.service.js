/**
 * Frame-level video metrics computed locally (no ML): blackscreen, motion, scene changes and
 * dominant-color change. Frames are downscaled to a tiny grayscale (and RGB) thumbnail so diffs
 * are cheap and robust to codec noise.
 *
 * Also exposes a helper to pick a subset of "interesting" frames for the heavy ML stage (SigLIP /
 * OCR / overlays), so we don't run those on every 1 fps frame and saturate CPU. We prefer frames
 * where a scene change happened (new graphics likely appeared) plus an even spread across the
 * window.
 */

import sharp from "sharp";
import { config } from "../config.js";

const GRID = 32; // downscale target (GRID x GRID)

/**
 * @param {string} framePath
 * @returns {Promise<{ gray: Uint8Array, meanLuma: number, meanRgb: [number, number, number] }>}
 */
async function loadFrameStats(framePath) {
  const img = sharp(framePath).resize(GRID, GRID, { fit: "fill" });

  const grayBuf = await img.clone().grayscale().raw().toBuffer();
  const gray = new Uint8Array(grayBuf);
  let lumaSum = 0;
  for (let i = 0; i < gray.length; i++) lumaSum += gray[i];
  const meanLuma = gray.length ? lumaSum / gray.length / 255 : 0;

  const { data, info } = await img.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels || 3;
  let r = 0;
  let g = 0;
  let b = 0;
  const px = data.length / channels;
  for (let i = 0; i < data.length; i += channels) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const meanRgb = px ? [r / px, g / px, b / px] : [0, 0, 0];

  return { gray, meanLuma, meanRgb };
}

/** Mean absolute difference between two grayscale thumbnails, normalized 0..1. */
function frameDiff(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n / 255;
}

function euclideanRgb(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / (255 * Math.sqrt(3));
}

/**
 * @param {string[]} framePaths
 * @returns {Promise<{
 *   metrics: {
 *     energy_avg: number, motion_avg: number, scene_change_rate: number,
 *     blackscreen_ratio: number, dominant_color_change: number
 *   },
 *   perFrameDiff: number[],
 * }>}
 */
export async function computeFrameMetrics(framePaths) {
  const stats = [];
  for (const p of framePaths) {
    stats.push(await loadFrameStats(p));
  }

  const diffs = [];
  const colorDiffs = [];
  for (let i = 1; i < stats.length; i++) {
    diffs.push(frameDiff(stats[i - 1].gray, stats[i].gray));
    colorDiffs.push(euclideanRgb(stats[i - 1].meanRgb, stats[i].meanRgb));
  }

  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const motion_avg = avg(diffs);

  const motionVar = diffs.length
    ? diffs.reduce((s, x) => s + (x - motion_avg) ** 2, 0) / diffs.length
    : 0;
  const energy_avg = Math.min(1, motion_avg + Math.sqrt(motionVar));

  const scene_change_rate = diffs.length
    ? diffs.filter((d) => d >= config.thresholds.sceneChange).length / diffs.length
    : 0;

  const blackScreens = stats.filter((s) => s.meanLuma <= config.thresholds.blackLuma).length;
  const blackscreen_ratio = stats.length ? blackScreens / stats.length : 0;

  const dominant_color_change = colorDiffs.length ? Math.max(...colorDiffs) : 0;

  // per-frame diff aligned to framePaths (frame 0 has no predecessor -> diff 0).
  const perFrameDiff = [0, ...diffs];

  return {
    metrics: {
      energy_avg: round(energy_avg),
      motion_avg: round(motion_avg),
      scene_change_rate: round(scene_change_rate),
      blackscreen_ratio: round(blackscreen_ratio),
      dominant_color_change: round(dominant_color_change),
    },
    perFrameDiff,
  };
}

/**
 * Pick up to `maxFrames` frames for the heavy ML stage. Strategy: always include the first and
 * last frame (window boundaries) and fill the rest with the highest inter-frame diff (scene
 * changes = likely new graphics/overlays), then de-duplicate and keep chronological order.
 *
 * @param {string[]} framePaths
 * @param {number[]} perFrameDiff  aligned to framePaths
 * @param {number} maxFrames
 * @returns {string[]} subset of framePaths (chronological)
 */
export function pickHeavyFrames(framePaths, perFrameDiff, maxFrames) {
  const n = framePaths.length;
  if (n === 0) return [];
  const cap = Math.max(1, Math.min(maxFrames || 1, n));
  if (n <= cap) return framePaths.slice();

  const idxSet = new Set([0, n - 1]);
  // Rank interior frames by descending diff and add until we hit the cap.
  const ranked = perFrameDiff
    .map((d, i) => ({ i, d }))
    .sort((a, b) => b.d - a.d)
    .map((x) => x.i);
  for (const i of ranked) {
    if (idxSet.size >= cap) break;
    idxSet.add(i);
  }
  return [...idxSet].sort((a, b) => a - b).map((i) => framePaths[i]);
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

export default { computeFrameMetrics, pickHeavyFrames };
