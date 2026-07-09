/**
 * HTTP client for the Python ML sidecar (Tesseract OCR + perceptual hashing + NLLB-200 translation).
 *
 *   POST /analyze { frame, fullOcr, translateFull, rois[] }
 *     -> { fullOcr: { text, textEn }, rois: [{ id, phash, ocrText, ocrTextEn }] }
 *
 *   POST /sample  { frame }
 *     -> { phash, ocrText, ocrTextEn }
 */

import { config } from "../config.js";
import { logger } from "../utils/logger.js";

async function postJson(pathname, payload, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.sidecar.baseUrl}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logger.warn("sidecar non-2xx", { pathname, status: res.status });
      return null;
    }
    return await res.json();
  } catch (e) {
    logger.warn("sidecar request failed", { pathname, error: String(e?.message || e) });
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Analyze a single frame: perceptual hash + OCR (+ translation) over the requested ROIs and the
 * full screen.
 *
 * @param {string} framePath absolute path readable by the sidecar (shared workDir)
 * @param {Array<{id:string,x:number,y:number,w:number,h:number,ocr?:boolean,translate?:boolean}>} rois
 * @param {{ fullOcr?: boolean, translateFull?: boolean }} [opts]
 */
export function analyzeFrame(framePath, rois = [], opts = {}) {
  return postJson(
    "/analyze",
    {
      frame: framePath,
      fullOcr: opts.fullOcr !== false,
      translateFull: opts.translateFull !== false,
      rois: Array.isArray(rois) ? rois : [],
      phashSize: config.rules.phashSize,
    },
    config.limits.analyzeTimeoutMs,
  );
}

/**
 * Analyze an uploaded template sample: perceptual hash + OCR (+ translation) over the whole image.
 * @param {string} framePath absolute path to the sample image
 */
export function analyzeSample(framePath) {
  return postJson(
    "/sample",
    { frame: framePath, phashSize: config.rules.phashSize },
    config.limits.sampleTimeoutMs,
  );
}

export default { analyzeFrame, analyzeSample };
