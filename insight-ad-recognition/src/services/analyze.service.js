/**
 * Orchestrates a single detection request:
 *   1. Extract the LAST frame of the trimmed VOD window                         [media.service]
 *   2. Crop/hash/OCR the configured ROIs + full-screen OCR (+ NLLB translation) [sidecar.client]
 *   3. Evaluate the per-channel strategies into a 0..1 score + verdict          [rules.engine]
 *   4. Build a preview of the analyzed frame.
 */

import { config } from "../config.js";
import { extractLastFrame } from "./media.service.js";
import { analyzeFrame } from "./sidecar.client.js";
import { normalizeConfig, collectRois, evaluate } from "./rules.engine.js";
import { buildMosaic } from "./preview.service.js";

/**
 * @param {string} videoUrl
 * @param {string} workDir
 * @param {object} rawConfig per-channel detection config posted by the CMS
 */
export async function analyzeVideo(videoUrl, workDir, rawConfig) {
  const t0 = Date.now();
  const cfg = normalizeConfig(rawConfig, config.rules.defaultThreshold);

  const tFrame = Date.now();
  const { framePath, isLive, inputMeta } = await extractLastFrame(videoUrl, workDir);
  const ffmpegMs = Date.now() - tFrame;

  // Preview of the analyzed frame (before the workDir is cleaned up).
  const previewFile = await buildMosaic([framePath], videoUrl).catch(() => null);

  const rois = collectRois(cfg);

  const tSidecar = Date.now();
  const analysis = (await analyzeFrame(framePath, rois, {
    fullOcr: true,
    translateFull: true,
  })) || { fullOcr: { text: "", textEn: "" }, rois: [] };
  const sidecarMs = Date.now() - tSidecar;

  const result = evaluate(cfg, analysis, { ffmpegMs, sidecarMs });
  const elapsedMs = Date.now() - t0;

  return {
    detection: result.detection,
    score: result.score,
    threshold: result.threshold,
    scores: result.scores,
    strategies: result.strategies,
    strategyResults: result.strategyResults,
    ocrText: result.ocrText,
    ocrTextEn: result.ocrTextEn,
    elapsedMs,
    timestamp: Math.floor(Date.now() / 1000),
    previewFile,
    meta: {
      elapsedMs,
      ffmpegMs,
      sidecarMs,
      isLive,
      input: inputMeta,
      roiCount: rois.length,
      enabledStrategies: result.strategyResults.enabledCount,
    },
  };
}

export default { analyzeVideo };
