/**
 * Centralized runtime configuration, resolved from environment variables.
 * All values have sane defaults so the service can boot without an .env file.
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

  segment: {
    // Analysis window length (seconds). Longer windows give whisper/vision more context per probe.
    seconds: Math.max(1, intEnv("SEGMENT_SECONDS", 20)),
    fps: Math.max(1, intEnv("FRAMES_PER_SECOND", 1)),
    liveEdgeMaxSegments: Math.max(1, intEnv("LIVE_EDGE_MAX_SEGMENTS", 8)),
  },

  tools: {
    ffmpeg: process.env.FFMPEG_BIN || "ffmpeg",
    ffprobe: process.env.FFPROBE_BIN || "ffprobe",
    whisperBin: process.env.WHISPER_BIN || "whisper-cli",
    // Multilingual ggml model (NOT the *.en model) so Hebrew/Spanish/English are all supported.
    whisperModel: process.env.WHISPER_MODEL || path.join(appRoot, "models", "ggml-base.bin"),
    // "auto" lets whisper detect the spoken language (Hebrew, Spanish, English, ...).
    whisperLanguage: (process.env.WHISPER_LANGUAGE || "auto").trim(),
    whisperThreads: Math.max(1, intEnv("WHISPER_THREADS", 4)),
    python: process.env.PYTHON_BIN || "python3",
  },

  sidecar: {
    autostart: boolEnv("ML_SIDECAR_AUTOSTART", true),
    host: process.env.ML_SIDECAR_HOST || "127.0.0.1",
    port: intEnv("ML_SIDECAR_PORT", 8100),
    startTimeoutMs: intEnv("ML_SIDECAR_START_TIMEOUT_MS", 120000),
    scriptPath: path.join(appRoot, "ml", "server.py"),
    get baseUrl() {
      return `http://${this.host}:${this.port}`;
    },
  },

  models: {
    siglip: process.env.SIGLIP_MODEL || "google/siglip-base-patch16-224",
    text: process.env.TEXT_MODEL || "typeform/distilbert-base-uncased-mnli",
    hfHome: process.env.HF_HOME || path.join(appRoot, "ml", "models_cache"),
  },

  limits: {
    // ffmpeg window extraction (frames + audio). Scaled up for the longer 20s window.
    requestTimeoutMs: intEnv("REQUEST_TIMEOUT_MS", 30000),
    /**
     * Dedicated budget for the `/vision` sidecar call (SigLIP over N frames + OCR). On CPU this is
     * far slower than the generic request timeout, and grows with the window length (more frames),
     * so it gets its own (larger) limit. Kept under the scheduler's per-probe budget
     * (AD_RECOGNITION_TIMEOUT_MS).
     */
    visionTimeoutMs: intEnv("VISION_TIMEOUT_MS", 90000),
    /** whisper.cpp transcription budget (grows with the window length + multilingual model). */
    whisperTimeoutMs: intEnv("WHISPER_TIMEOUT_MS", 60000),
    maxConcurrentJobs: Math.max(1, intEnv("MAX_CONCURRENT_JOBS", 4)),
  },

  /**
   * Per-request frame mosaic preview. One file per analyzed channel (filename = sanitized `video`),
   * served over HTTP and swept after `ttlMs`.
   */
  previews: {
    dir: process.env.PREVIEW_DIR || path.join(os.tmpdir(), "insight-ad-recognition-previews"),
    route: "/previews",
    ttlMs: intEnv("PREVIEW_TTL_MS", 12 * 60 * 60 * 1000),
    sweepIntervalMs: intEnv("PREVIEW_SWEEP_INTERVAL_MS", 30 * 60 * 1000),
    tileWidth: intEnv("PREVIEW_TILE_WIDTH", 320),
    tileHeight: intEnv("PREVIEW_TILE_HEIGHT", 180),
    /** Optional absolute base URL for url_image (e.g. https://ads.example.com). Empty = derive from request. */
    publicBaseUrl: (process.env.PREVIEW_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""),
  },

  /** SigLIP zero-shot category prompts (order preserved for logging). */
  visionCategories: [
    "TV commercial",
    "Television program",
    "Movie",
    "News broadcast",
    "Sports broadcast",
    "Talk show",
    "Studio",
    "Animation",
    "Black screen",
    "Slate",
    "Test pattern",
    "Logo bumper",
    "Credits",
  ],

  thresholds: {
    /** Mean luma (0..1) below which a frame counts as a black screen. */
    blackLuma: floatEnv("BLACK_LUMA_THRESHOLD", 0.06),
    /** Normalized inter-frame diff above which a scene change is counted. */
    sceneChange: floatEnv("SCENE_CHANGE_THRESHOLD", 0.25),
    /** RMS dBFS above which audio is considered non-silent (ffmpeg silencedetect noise floor). */
    silenceDb: floatEnv("SILENCE_NOISE_DB", -35),
  },
};

export default config;
