/**
 * Centralized runtime configuration, resolved from environment variables.
 * All values have sane defaults so the service can boot without an .env file.
 *
 * Rule-engine pipeline: the CMS posts a trimmed VOD window (`endTime ≈ startTime + 60s` embedded in
 * the `video` URL) plus a per-channel detection config. The service grabs ONLY the last keyframe,
 * runs Tesseract OCR (heb/eng/spa) + perceptual hashing over the configured ROIs, translates the
 * OCR text to English with NLLB-200, evaluates the configured strategies (logo appearance, logo
 * disappearance, OCR rules) into a 0..1 score each, and returns the average + verdict.
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

function intEnv(name, def) {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : def;
}

function floatEnv(name, def) {
  const v = parseFloat(process.env[name] ?? "");
  return Number.isFinite(v) ? v : def;
}

function boolEnv(name, def) {
  const v = process.env[name];
  if (v == null || v === "") return def;
  return /^(1|true|yes|on)$/i.test(v);
}

export const config = {
  appRoot,
  port: intEnv("PORT", 8081),

  /** Shared secret. Empty string disables authentication. */
  apiSecret: (process.env.API_SECRET ?? "").trim(),

  frame: {
    // Tail window (seconds) fed to ffmpeg when seeking the end of a VOD/archive clip. We keep the
    // LAST decoded frame within this window (`-update 1`), so it just needs to be long enough to
    // cover a couple of GOPs.
    tailSeconds: Math.max(1, intEnv("FRAME_TAIL_SECONDS", 4)),
  },

  tools: {
    ffmpeg: process.env.FFMPEG_BIN || "ffmpeg",
    ffprobe: process.env.FFPROBE_BIN || "ffprobe",
    python: process.env.PYTHON_BIN || "python3",
  },

  sidecar: {
    autostart: boolEnv("ML_SIDECAR_AUTOSTART", true),
    host: process.env.ML_SIDECAR_HOST || "127.0.0.1",
    port: intEnv("ML_SIDECAR_PORT", 8100),
    startTimeoutMs: intEnv("ML_SIDECAR_START_TIMEOUT_MS", 600000),
    scriptPath: path.join(appRoot, "ml", "server.py"),
    get baseUrl() {
      return `http://${this.host}:${this.port}`;
    },
  },

  models: {
    // NLLB-200 (Meta) multilingual translation model used to translate OCR text into English.
    nllb: process.env.NLLB_MODEL || "facebook/nllb-200-distilled-600M",
    hfHome: process.env.HF_HOME || path.join(appRoot, "ml", "models_cache"),
  },

  ocr: {
    // Must match installed Tesseract traineddata (tesseract-ocr-<lang>).
    languages: (process.env.OCR_LANGUAGES || "heb+eng+spa").trim(),
    minConfidence: floatEnv("OCR_MIN_CONFIDENCE", 40),
  },

  rules: {
    // Fallback ad/program threshold used when the posted config omits one.
    defaultThreshold: floatEnv("AD_DEFAULT_THRESHOLD", 0.5),
    // Perceptual-hash size in bytes/side handed to the sidecar (imagehash phash -> hash_size).
    // 8 => a 64-bit hash. Kept here so both sides agree.
    phashSize: Math.max(4, intEnv("PHASH_SIZE", 8)),
  },

  limits: {
    /** ffmpeg last-frame extraction budget. */
    requestTimeoutMs: intEnv("REQUEST_TIMEOUT_MS", 30000),
    /** `/analyze` sidecar call (OCR + pHash + NLLB over the frame). */
    analyzeTimeoutMs: intEnv("ANALYZE_TIMEOUT_MS", 90000),
    /** `/sample` sidecar call (template OCR + pHash on upload). */
    sampleTimeoutMs: intEnv("SAMPLE_TIMEOUT_MS", 60000),
    /** Per-image HTTP fetch budget (public S3 sample URLs) on the Node side. */
    sampleFetchTimeoutMs: intEnv("SAMPLE_FETCH_TIMEOUT_MS", 8000),
    maxConcurrentJobs: Math.max(1, intEnv("MAX_CONCURRENT_JOBS", 4)),
  },

  /**
   * Single last-frame preview (one file per analyzed channel), served over HTTP and swept after
   * `ttlMs`.
   */
  previews: {
    dir: process.env.PREVIEW_DIR || path.join(os.tmpdir(), "insight-ad-recognition-previews"),
    route: "/previews",
    ttlMs: intEnv("PREVIEW_TTL_MS", 12 * 60 * 60 * 1000),
    sweepIntervalMs: intEnv("PREVIEW_SWEEP_INTERVAL_MS", 30 * 60 * 1000),
    tileWidth: intEnv("PREVIEW_TILE_WIDTH", 480),
    tileHeight: intEnv("PREVIEW_TILE_HEIGHT", 270),
    publicBaseUrl: (process.env.PREVIEW_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""),
  },
};

export default config;
