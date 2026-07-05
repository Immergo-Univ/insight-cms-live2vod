/**
 * HTTP client for the Python ML sidecar. Returns null on any failure so the orchestrator can
 * degrade gracefully to local-only signals.
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
 * Run SigLIP zero-shot classification + OCR over the frames.
 * @param {string[]} framePaths absolute paths readable by the sidecar (shared filesystem)
 */
export function inferVision(framePaths) {
  return postJson("/vision", { frames: framePaths }, config.limits.visionTimeoutMs);
}

/**
 * Classify the transcript as commercial vs program (the "BERT" text stage).
 * @param {string} transcript
 */
export function inferText(transcript) {
  return postJson("/text", { text: transcript || "" }, Math.min(config.limits.requestTimeoutMs, 8000));
}

export default { inferVision, inferText };
