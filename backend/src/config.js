import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");

/**
 * S3-compatible logos (DO Spaces, MinIO, AWS). Keys: S3_* or AWS_* or DO tutorial SPACES_* / SPACES_SECRET.
 * When enabled, also backs up channel ads/timeline JSON to `{prefix}/channel-ads/<channelId>.json` and restores newer copies on startup.
 *
 * DigitalOcean Spaces: aligned with immergo-producer `utils/s3.js` — path-style addressing
 * (`forcePathStyle: true`) and `S3_REGION` defaulting to us-east-1 when unset. Public URLs there are built as
 * `${S3_ENDPOINT}/${S3_BUCKET_NAME}/${key}`. Override signing with S3_SIGNING_REGION if needed.
 */
const s3LogosResolved = (() => {
  const accessKeyId = (
    process.env.S3_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.SPACES_KEY ||
    ""
  ).trim();
  const secretAccessKey = (
    process.env.S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.SPACES_SECRET ||
    ""
  ).trim();
  const bucket = (process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || "").trim();
  const endpoint = (process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT_URL_S3 || "").trim();
  const isDigitalOceanSpaces = /digitaloceanspaces\.com/i.test(endpoint);
  const region = (() => {
    if (process.env.S3_SIGNING_REGION?.trim()) return process.env.S3_SIGNING_REGION.trim();
    if (isDigitalOceanSpaces) return (process.env.S3_REGION || "us-east-1").trim();
    return (process.env.S3_REGION || process.env.AWS_REGION || "us-east-1").trim();
  })();
  /** DO Spaces: immergo-producer uses s3ForcePathStyle: true; virtual-hosted (false) often breaks uploads. */
  const forcePathStyle =
    process.env.S3_FORCE_PATH_STYLE === "false"
      ? false
      : process.env.S3_FORCE_PATH_STYLE === "true"
        ? true
        : isDigitalOceanSpaces;
  const enabled =
    process.env.S3_LOGOS_ENABLED !== "false" &&
    Boolean(accessKeyId && secretAccessKey && bucket && endpoint);
  return {
    enabled,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    region,
    forcePathStyle,
    prefix: (process.env.S3_LOGOS_PREFIX || "channel-logos").replace(/^\/+|\/+$/g, ""),
    syncIntervalMs: parseInt(process.env.CHANNEL_LOGOS_S3_SYNC_INTERVAL_MS || "60000", 10),
  };
})();

export const config = {
  insightApiBase: process.env.INSIGHT_API_BASE || "https://insight-api-frankly.univtec.com",
  port: process.env.PORT || 3001,
  insightApiUsername: process.env.INSIGHT_API_USERNAME,
  insightApiPassword: process.env.INSIGHT_API_PASSWORD,
  /** Default tenant IDs (same as x-tenant-id) for live discovery when env lists are empty. */
  tenants: ["channel14", "rjr"],

  backendRoot,

  /** Per-channel timeline snapshots (ads, live probe fields). */
  channelsDataDir: path.join(backendRoot, "data", "channels"),

  /**
   * Drop precalculated `ads` entries older than this (hours) when serving the timeline.
   * Env: ADS_RETENTION_HOURS
   */
  adsRetentionHours: parseInt(process.env.ADS_RETENTION_HOURS || process.env.LOGO_SCAN_ARCHIVE_HOURS || "72", 10),

  /**
   * OpenCV logo-detector CLI (template matching on one frame from m3u8).
   * Threshold / scales are passed to the process environment (LOGO_DETECTOR_*).
   */
  logoDetector: {
    threshold: (() => {
      const v = parseFloat(process.env.LOGO_DETECTOR_THRESHOLD ?? process.env.LOGO_SCAN_MATCHER_THRESHOLD ?? "0.78");
      return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.78;
    })(),
    scaleMin: (() => {
      const v = parseFloat(process.env.LOGO_DETECTOR_SCALE_MIN ?? process.env.LOGO_SCAN_MATCHER_SCALE_MIN ?? "0.72");
      return Number.isFinite(v) && v > 0 ? v : 0.72;
    })(),
    scaleMax: (() => {
      const v = parseFloat(process.env.LOGO_DETECTOR_SCALE_MAX ?? process.env.LOGO_SCAN_MATCHER_SCALE_MAX ?? "1.28");
      return Number.isFinite(v) && v > 0 ? v : 1.28;
    })(),
    scaleSteps: (() => {
      const raw =
        process.env.LOGO_DETECTOR_SCALE_STEPS ||
        process.env.LOGO_SCAN_MATCHER_SCALE_STEPS ||
        "17";
      const v = parseInt(raw, 10);
      return Number.isFinite(v) && v >= 1 && v <= 64 ? v : 17;
    })(),
    dir: path.join(backendRoot, "utils", "logo-detector"),
    bin: path.join(backendRoot, "utils", "logo-detector", "logo-detector"),
    /** Timeout for one detector run (ffmpeg + OpenCV). */
    runTimeoutMs: parseInt(process.env.LOGO_DETECTOR_TIMEOUT_MS || process.env.LOGO_SCAN_MATCHER_TIMEOUT_MS || "900000", 10),
    /**
     * When true, spawn logo-detector with --debug and LOGO_DETECTOR_DEBUG_PATH per channel
     * (logo-detector-debug-<channelId>.jpg under debugImageDir). Opt out: LOGO_DETECTOR_DEBUG=0
     */
    debugLogoDetector: process.env.LOGO_DETECTOR_DEBUG !== "0",
    /** Directory for per-channel debug JPEGs. Env: LOGO_DETECTOR_DEBUG_DIR */
    debugImageDir: process.env.LOGO_DETECTOR_DEBUG_DIR || path.join(backendRoot, "utils", "logo-detector"),
  },

  /**
   * Live HLS: logo-detector on stream URL + hysteresis. Set LOGO_LIVE_MATCHING_ENABLED=false to disable.
   */
  logoLiveMatching: {
    enabled: process.env.LOGO_LIVE_MATCHING_ENABLED !== "false",
    discoveryIntervalMs: parseInt(process.env.LOGO_LIVE_DISCOVERY_INTERVAL_MS || "60000", 10),
    /** If live startTime-only probe fails, retry once with the raw stream URL. Env: LOGO_LIVE_PROBE_FALLBACK_RAW=false to disable */
    probeFallbackRaw: process.env.LOGO_LIVE_PROBE_FALLBACK_RAW !== "false",
    /** Single logo-detector run (ffmpeg + OpenCV) per live tick; 2s is too low for most CDNs. Env: LOGO_LIVE_PROBE_TIMEOUT_MS */
    probeTimeoutMs: (() => {
      const v = parseInt(process.env.LOGO_LIVE_PROBE_TIMEOUT_MS || "15000", 10);
      return Number.isFinite(v) ? Math.max(3000, v) : 15000;
    })(),
    stateFilePath:
      process.env.LOGO_LIVE_MATCHING_STATE_FILE ||
      path.join(backendRoot, "data", "logo-live-matching-state.json"),
    tenantIds: (process.env.LOGO_LIVE_TENANTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  channelSettings: {
    dataDir: path.join(backendRoot, "data", "channel-settings"),
    logosDir: path.join(backendRoot, "data", "channel-logos"),
  },

  /** Live2VOD editor clip poster images (disk + same S3 bucket/prefix as logos under `posters/`). */
  editorPosters: {
    dataDir: path.join(backendRoot, "data", "editor-posters"),
  },

  s3Logos: s3LogosResolved,

  /**
   * Remote VOD encoder (encoder-lite). Backend dispatches jobs via HTTP; encoder PATCHes job state here.
   * Env: ENCODER_SERVICE_URL (e.g. http://encoder:3010), SECRET (shared Bearer). ENCODER_SECRET is still accepted as an alias.
   */
  encoder: {
    serviceUrl: (process.env.ENCODER_SERVICE_URL || "").trim().replace(/\/+$/, ""),
    secret: (process.env.SECRET || process.env.ENCODER_SECRET || "").trim(),
  },

  /**
   * Optional archive window probe: logo-detector on DVR m3u8 per channel (same env as legacy LOGO_SCAN_*).
   * Skips channels with no uploaded logos. Re-evaluates every cycle when logos appear later.
   */
  logoArchiveScan: {
    cyclePauseMs: parseInt(process.env.LOGO_SCAN_CYCLE_PAUSE_MS || "45000", 10),
    /** One detector pass per half-window; smaller = finer ad edges but more CDN/probe load. Env: LOGO_SCAN_MATCHER_WINDOW_SEC */
    windowSeconds: parseInt(process.env.LOGO_SCAN_MATCHER_WINDOW_SEC || "60", 10),
    stateFilePath:
      process.env.LOGO_ARCHIVE_SCAN_STATE_FILE ||
      path.join(backendRoot, "data", "logo-archive-scan-state.json"),
  },
};
