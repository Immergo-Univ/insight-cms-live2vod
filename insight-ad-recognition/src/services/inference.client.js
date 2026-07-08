/**
 * HTTP client for the Python ML sidecar. Returns null on any failure so the orchestrator can
 * degrade gracefully to local-only signals.
 *
 * The sidecar hosts a CLAP (audio zero-shot) classifier — no vision/OCR/text stages anymore.
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
 * Score the audio channel against the CLAP category prompts, chunked at `chunkSeconds` intervals.
 *
 * @param {string} audioPath absolute path to a mono 48 kHz PCM WAV readable by the sidecar
 *   (shared workDir volume with the Node process).
 * @param {number} [chunkSeconds]
 * @returns {Promise<null | {
 *   chunks: Array<{
 *     startSec: number, endSec: number, category: string, score: number,
 *     scores: Record<string, number>
 *   }>,
 *   avg: { category: string, score: number, per_category: Record<string, number> },
 *   last: null | { startSec: number, endSec: number, category: string, score: number },
 *   durationSec: number,
 *   chunkSeconds: number
 * }>}
 */
export function inferAudio(audioPath, chunkSeconds = config.audio.chunkSeconds) {
  if (!audioPath) return Promise.resolve(null);
  return postJson(
    "/audio",
    { path: audioPath, chunkSeconds },
    config.limits.audioTimeoutMs,
  );
}

export default { inferAudio };
