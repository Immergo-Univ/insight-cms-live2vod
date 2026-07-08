/**
 * Centralized runtime configuration, resolved from environment variables.
 * All values have sane defaults so the service can boot without an .env file.
 *
 * The service is audio-only: a short window of the stream is extracted with ffmpeg and its audio
 * channel is scored against a fixed list of programming categories using CLAP (the audio analogue
 * of CLIP) inside a Python sidecar. Frames are still captured, but only to render the debugging
 * mosaic preview that the operator sees in the response.
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
    // Analysis window length (seconds). Longer windows give CLAP more chunks per probe and give
    // the caller better temporal resolution to pinpoint AD transitions inside the window.
    seconds: Math.max(1, intEnv("SEGMENT_SECONDS", 20)),
    // Frames captured for the debug mosaic only. CLAP does NOT consume frames.
    fps: Math.max(1, intEnv("FRAMES_PER_SECOND", 1)),
    liveEdgeMaxSegments: Math.max(1, intEnv("LIVE_EDGE_MAX_SEGMENTS", 8)),
  },

  audio: {
    /**
     * Length (seconds) of each CLAP inference chunk within the analysis window. Enforced to at
     * least one sample every 5 seconds by default so we can locate the exact chunk where an AD
     * starts inside the window. Configurable via AUDIO_CHUNK_SECONDS.
     */
    chunkSeconds: Math.max(1, floatEnv("AUDIO_CHUNK_SECONDS", 5)),
    /** Sample rate for the CLAP-facing WAV (CLAP is trained at 48 kHz). */
    clapSampleRate: 48000,
    /** Sample rate for the whisper-facing WAV (whisper.cpp expects 16 kHz mono PCM). */
    whisperSampleRate: 16000,
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
    // CLAP zero-shot audio→category classifier. `unfused` is ~380 MB and works well on CPU.
    // Alternatives: laion/larger_clap_general, laion/larger_clap_music_and_speech.
    clap: process.env.CLAP_MODEL || "laion/clap-htsat-unfused",
    hfHome: process.env.HF_HOME || path.join(appRoot, "ml", "models_cache"),
  },

  limits: {
    // ffmpeg window extraction (frames + audio). Scaled up for the longer 20 s window.
    requestTimeoutMs: intEnv("REQUEST_TIMEOUT_MS", 30000),
    /**
     * Dedicated budget for the `/audio` sidecar call (CLAP over N chunks). On CPU this grows
     * with the window length; kept generous but under the scheduler's per-probe budget
     * (AD_RECOGNITION_TIMEOUT_MS).
     */
    audioTimeoutMs: intEnv("AUDIO_TIMEOUT_MS", 90000),
    /** whisper.cpp transcription budget (grows with window length + multilingual model). */
    whisperTimeoutMs: intEnv("WHISPER_TIMEOUT_MS", 60000),
    maxConcurrentJobs: Math.max(1, intEnv("MAX_CONCURRENT_JOBS", 4)),
  },

  /**
   * Per-request frame mosaic preview. One file per analyzed channel (filename = sanitized `video`),
   * served over HTTP and swept after `ttlMs`. This is purely a UX aid so the operator sees what
   * was captured — the classifier no longer reads pixel data.
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

  /**
   * CLAP zero-shot category prompts. Ordered so the "advertisement-like" classes come first for
   * logging clarity. Keep in sync with ml/server.py DEFAULT_CATEGORIES.
   */
  audioCategories: [
    "Television commercial",
    "Advertisement",
    "News broadcast",
    "Sports broadcast",
    "Movie",
    "TV series",
    "Talk show",
    "Interview",
    "Music performance",
    "Weather forecast",
    "Children's program",
  ],

  /**
   * Categories that mark the audio as an ad break. Every other category in `audioCategories` is
   * treated as regular programming. Adjust via AD_CATEGORIES env (JSON array of strings).
   */
  adCategories: (() => {
    const raw = process.env.AD_CATEGORIES;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed.map(String);
      } catch {
        /* fall through */
      }
    }
    return ["Television commercial", "Advertisement"];
  })(),

  thresholds: {
    /**
     * Minimum CLAP probability an "ad" category must reach in the LAST chunk of the window to
     * flip the verdict to "ad". Below this we stay in "program" — prevents borderline scores
     * (e.g. a music-heavy program bumper) from being read as a commercial.
     */
    adMinScore: floatEnv("AD_MIN_SCORE", 0.35),
    /**
     * RMS dBFS above which audio is considered non-silent (ffmpeg silencedetect noise floor).
     * Used as a soft "black/silence" fallback since the profile no longer has frame metrics.
     */
    silenceDb: floatEnv("SILENCE_NOISE_DB", -35),
    /**
     * silence_ratio above which the window is considered a black/silent break (audio-only proxy
     * for what the old blackscreen_ratio detected).
     */
    silenceRatio: floatEnv("SILENCE_RATIO_THRESHOLD", 0.9),
  },
};

export default config;
