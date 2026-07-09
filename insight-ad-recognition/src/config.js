/**
 * Centralized runtime configuration, resolved from environment variables.
 * All values have sane defaults so the service can boot without an .env file.
 *
 * Multimodal pipeline: a short archive window of the stream is extracted with ffmpeg and analyzed
 * with a CPU model battery — SigLIP (visual), Tesseract OCR (heb/eng/spa) + regex cues + mDeBERTa
 * (semantic text) and OpenCV overlay detection — plus local ffmpeg audio metrics (RMS / silence /
 * music), fused into an ad/program/silence verdict with intra-window temporal consistency.
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
    // Analysis window length (seconds). The CMS probes a VOD/archive window of this size.
    seconds: Math.max(1, intEnv("SEGMENT_SECONDS", 10)),
    // Frames captured for analysis (1 fps by default => ~10 frames in a 10s window).
    fps: Math.max(1, intEnv("FRAMES_PER_SECOND", 1)),
    // Max frames handed to the heavy ML stage (SigLIP/OCR/overlays) to bound CPU cost. The rest are
    // still used for the cheap local metrics (blackscreen/motion/scene-change).
    heavyMaxFrames: Math.max(1, intEnv("HEAVY_MAX_FRAMES", 5)),
    liveEdgeMaxSegments: Math.max(1, intEnv("LIVE_EDGE_MAX_SEGMENTS", 8)),
  },

  audio: {
    /** Sample rate for the whisper-facing WAV (whisper.cpp expects 16 kHz mono PCM). */
    whisperSampleRate: 16000,
  },

  tools: {
    ffmpeg: process.env.FFMPEG_BIN || "ffmpeg",
    ffprobe: process.env.FFPROBE_BIN || "ffprobe",
    whisperBin: process.env.WHISPER_BIN || "whisper-cli",
    whisperModel: process.env.WHISPER_MODEL || path.join(appRoot, "models", "ggml-base.bin"),
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
    // Visual zero-shot classifier.
    siglip: process.env.SIGLIP_MODEL || "google/siglip-base-patch16-224",
    // Multilingual XNLI zero-shot model for the semantic OCR-text stage (Hebrew/Spanish/English).
    text: process.env.TEXT_MODEL || "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli",
    hfHome: process.env.HF_HOME || path.join(appRoot, "ml", "models_cache"),
  },

  limits: {
    // ffmpeg window extraction (frames + audio).
    requestTimeoutMs: intEnv("REQUEST_TIMEOUT_MS", 30000),
    /** `/vision` sidecar call (SigLIP + OCR + overlays over the heavy frames). */
    visionTimeoutMs: intEnv("VISION_TIMEOUT_MS", 90000),
    /** `/text` sidecar call (mDeBERTa zero-shot). */
    textTimeoutMs: intEnv("TEXT_TIMEOUT_MS", 15000),
    /** `/logo` sidecar call (OpenCV ROI detect / template match). */
    logoTimeoutMs: intEnv("LOGO_TIMEOUT_MS", 20000),
    /** Per-template HTTP fetch budget (public S3 URLs) on the Node side. */
    logoTemplateFetchTimeoutMs: intEnv("LOGO_TEMPLATE_FETCH_TIMEOUT_MS", 8000),
    /** whisper.cpp transcription budget. */
    whisperTimeoutMs: intEnv("WHISPER_TIMEOUT_MS", 60000),
    maxConcurrentJobs: Math.max(1, intEnv("MAX_CONCURRENT_JOBS", 4)),
  },

  /**
   * Per-request frame mosaic preview (one file per analyzed channel), served over HTTP and swept
   * after `ttlMs`.
   */
  previews: {
    dir: process.env.PREVIEW_DIR || path.join(os.tmpdir(), "insight-ad-recognition-previews"),
    route: "/previews",
    ttlMs: intEnv("PREVIEW_TTL_MS", 12 * 60 * 60 * 1000),
    sweepIntervalMs: intEnv("PREVIEW_SWEEP_INTERVAL_MS", 30 * 60 * 1000),
    tileWidth: intEnv("PREVIEW_TILE_WIDTH", 320),
    tileHeight: intEnv("PREVIEW_TILE_HEIGHT", 180),
    publicBaseUrl: (process.env.PREVIEW_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""),
  },

  /**
   * SigLIP visual categories (Spanish key -> English prompt ENSEMBLE). Passed to the sidecar as
   * VISUAL_CATEGORY_PROMPTS so both sides agree. Multiple prompts per category improve zero-shot
   * separation; the sidecar ensemble-averages them. `publicidad`/`placa`/`institucional` count as
   * ad evidence in the fusion layer; `programa`/`noticia`/`deporte` as program.
   */
  visualCategories: {
    programa: [
      "a television program",
      "a tv studio show with a host",
      "a talk show set with people talking",
      "an entertainment television show",
    ],
    publicidad: [
      "a television commercial",
      "an advertisement for a product",
      "a product close-up with a price on screen",
      "an infomercial demonstrating a product",
      "a retail store sale advertisement",
      "a car or furniture commercial",
    ],
    placa: [
      "a full-screen graphic title card",
      "a full screen promo slate with big text",
      "a sponsor graphic card",
      "a text-only promotional screen",
    ],
    noticia: [
      "a television news broadcast",
      "a news anchor at a desk",
      "a breaking news screen with a lower-third ticker",
      "a news report from the field",
    ],
    deporte: [
      "a live sports broadcast",
      "athletes playing on a field or court",
      "a sports match with a scoreboard",
      "a stadium full of spectators",
    ],
    institucional: [
      "a tv channel logo bumper",
      "a television station ident",
      "an institutional or public-service promo",
      "a channel branding animation",
    ],
  },

  /** OCR (Tesseract) configuration passed to the sidecar. */
  ocr: {
    languages: (process.env.OCR_LANGUAGES || "heb+eng+spa").trim(),
    minConfidence: floatEnv("OCR_MIN_CONFIDENCE", 40),
  },

  /** Channel-logo stage (ROI auto-detection + template matching for logo present/absent). */
  logo: {
    // Max template crops passed to the matcher per probe (more = slower, diminishing returns).
    maxTemplates: Math.max(1, intEnv("LOGO_MAX_TEMPLATES", 8)),
    // present_ratio below which the window is considered "logo gone" (ad-side evidence).
    absentRatio: floatEnv("LOGO_ABSENT_RATIO", 0.34),
    // present_ratio above which the logo is clearly present (program-side evidence).
    presentRatio: floatEnv("LOGO_PRESENT_RATIO", 0.66),
  },

  /**
   * Multimodal fusion weights. Each contributing signal is bounded and combined into the ad/program
   * scores. All tunable via env for field calibration.
   */
  fusion: {
    // Advertisement evidence weights. Visual now carries a real softmax score (0..1) thanks to the
    // SigLIP prompt-ensemble + softmax normalization, so it's weighted as a first-class signal.
    visualAd: floatEnv("FUSION_VISUAL_AD", 0.4),
    // Overlays appear in ~all broadcast content (news tickers, sports L3, logos), so this is only
    // a minor reinforcement — kept low on purpose to avoid false positives on newscasts.
    overlay: floatEnv("FUSION_OVERLAY", 0.08),
    ocrStrongPer: floatEnv("FUSION_OCR_STRONG_PER", 0.12),
    ocrStrongCap: floatEnv("FUSION_OCR_STRONG_CAP", 0.4),
    ocrContactBonus: floatEnv("FUSION_OCR_CONTACT_BONUS", 0.2),
    // A visible URL (e.g. soferavi.co.il) is a strong direct-response ad signal — extra bump on
    // top of the generic strong-cue weight.
    ocrUrlBonus: floatEnv("FUSION_OCR_URL_BONUS", 0.08),
    // Weak cues (CTA wording / legal): small, capped — never enough on their own.
    ocrWeak: floatEnv("FUSION_OCR_WEAK", 0.04),
    ocrWeakCap: floatEnv("FUSION_OCR_WEAK_CAP", 0.06),
    bertLabelThreshold: floatEnv("FUSION_BERT_LABEL_THRESHOLD", 0.5),
    bertTriad: floatEnv("FUSION_BERT_TRIAD", 0.4),
    bertPair: floatEnv("FUSION_BERT_PAIR", 0.15),
    // Graded contribution from the single strongest ad-intent label (brand/cta/price/contact).
    // Captures on-screen brand/product names that don't reach the full triad. Thresholded so
    // ordinary news wording (brand ~0.14) contributes nothing.
    bertSingle: floatEnv("FUSION_BERT_SINGLE", 0.28),
    bertSingleThreshold: floatEnv("FUSION_BERT_SINGLE_THRESHOLD", 0.35),
    // Music-bed heavy with little speech (jingle-like) leans commercial. Uses the local ffmpeg
    // audio metrics (music_probability / speech_ratio), not a model.
    musicBed: floatEnv("FUSION_MUSIC_BED", 0.08),
    fastCut: floatEnv("FUSION_FAST_CUT", 0.1),
    // Channel-logo evidence. Logo GONE (after we have templates) is a strong ad signal on channels
    // that keep a persistent logo bug during programming; logo PRESENT is strong program evidence.
    logoAbsent: floatEnv("FUSION_LOGO_ABSENT", 0.4),
    logoPresent: floatEnv("FUSION_LOGO_PRESENT", 0.3),
    // Program evidence weights.
    visualProgram: floatEnv("FUSION_VISUAL_PROGRAM", 0.45),
    programSpeech: floatEnv("FUSION_PROGRAM_SPEECH", 0.1),
    bertProgram: floatEnv("FUSION_BERT_PROGRAM", 0.1),
    // Discriminative-gate threshold: the dominant SigLIP ad category (softmax) must clear this to
    // qualify "ad" on visual grounds alone. With 6 categories, chance is ~0.17, so 0.4 = confident.
    sustainedVisualScore: floatEnv("FUSION_SUSTAINED_VISUAL_SCORE", 0.4),
  },

  thresholds: {
    /** Mean luma (0..1) below which a frame counts as a black screen. */
    blackLuma: floatEnv("BLACK_LUMA_THRESHOLD", 0.06),
    /** Normalized inter-frame diff above which a scene change is counted. */
    sceneChange: floatEnv("SCENE_CHANGE_THRESHOLD", 0.25),
    /** RMS dBFS above which audio is considered non-silent (ffmpeg silencedetect noise floor). */
    silenceDb: floatEnv("SILENCE_NOISE_DB", -35),
    /** silence_ratio above which the window is considered a silence/dead-air break. */
    silenceRatio: floatEnv("SILENCE_RATIO_THRESHOLD", 0.9),
    /** Minimum ad score required to declare "ad". */
    adMinScore: floatEnv("AD_MIN_SCORE", 0.35),
  },
};

export default config;
