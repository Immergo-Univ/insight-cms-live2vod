/**
 * HTTP client for the Python ML sidecar. Returns null on any failure so the orchestrator can
 * degrade gracefully to whatever local signals are available.
 *
 * The sidecar hosts the CPU model battery: SigLIP (vision) + Tesseract OCR + OpenCV overlays on
 * `/vision`, and mDeBERTa zero-shot on `/text`.
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
 * Run SigLIP zero-shot classification + OCR + overlay detection over the (heavy-sampled) frames.
 * @param {string[]} framePaths absolute paths readable by the sidecar (shared workDir)
 */
export function inferVision(framePaths) {
  if (!Array.isArray(framePaths) || framePaths.length === 0) return Promise.resolve(null);
  return postJson("/vision", { frames: framePaths }, config.limits.visionTimeoutMs);
}

/**
 * Classify the OCR text into ad-intent semantic labels (CTA/price/brand/legal/contact/program).
 * @param {string} text aggregated OCR text
 */
export function inferText(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return Promise.resolve(null);
  return postJson("/text", { text: trimmed }, config.limits.textTimeoutMs);
}

export default { inferVision, inferText };
