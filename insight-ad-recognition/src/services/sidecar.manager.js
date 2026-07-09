/**
 * Manages the in-container Python ML sidecar (CLAP zero-shot audio classifier).
 * The sidecar is a long-lived process that preloads CLAP once so per-request inference is fast
 * and safe for concurrent calls. Node talks to it over localhost HTTP.
 */

import { spawn } from "node:child_process";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let child = null;
let ready = false;

async function pingHealth(timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.sidecar.baseUrl}/health`, { signal: ctrl.signal });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return Boolean(body?.ready);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export function isSidecarReady() {
  return ready;
}

/**
 * Start the sidecar (if autostart enabled) and wait until it reports ready.
 * Resolves to `true` when usable, `false` when unavailable (service still runs in degraded mode).
 */
export async function ensureSidecar() {
  if (ready) return true;

  // If something is already serving (e.g. started externally), just use it.
  if (await pingHealth()) {
    ready = true;
    return true;
  }

  if (!config.sidecar.autostart) {
    logger.warn("ML sidecar autostart disabled and no external sidecar reachable");
    return false;
  }

  if (!child) {
    logger.info("Starting ML sidecar", { script: config.sidecar.scriptPath, port: config.sidecar.port });
    child = spawn(
      config.tools.python,
      [config.sidecar.scriptPath],
      {
        env: {
          ...process.env,
          ML_SIDECAR_PORT: String(config.sidecar.port),
          ML_SIDECAR_HOST: config.sidecar.host,
          SIGLIP_MODEL: config.models.siglip,
          TEXT_MODEL: config.models.text,
          CLAP_MODEL: config.models.clap,
          HF_HOME: config.models.hfHome,
          AUDIO_CATEGORIES: JSON.stringify(config.audioCategories),
          VISUAL_CATEGORY_PROMPTS: JSON.stringify(config.visualCategories),
          OCR_LANGUAGES: config.ocr.languages,
          OCR_MIN_CONFIDENCE: String(config.ocr.minConfidence),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => process.stdout.write(`[ml] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[ml] ${d}`));
    child.on("exit", (code) => {
      logger.error("ML sidecar exited", { code });
      child = null;
      ready = false;
    });
  }

  const deadline = Date.now() + config.sidecar.startTimeoutMs;
  while (Date.now() < deadline) {
    if (await pingHealth()) {
      ready = true;
      logger.info("ML sidecar ready");
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  logger.error("ML sidecar failed to become ready before timeout");
  return false;
}

export function stopSidecar() {
  if (child) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    child = null;
    ready = false;
  }
}

export default { ensureSidecar, isSidecarReady, stopSidecar };
