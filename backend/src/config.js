import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");

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
    debugLogoDetector:
      process.env.LOGO_DETECTOR_DEBUG !== "0" &&
      (process.env.NODE_ENV === "development" || process.env.LOGO_DETECTOR_DEBUG === "1"),
    /** Directory for per-channel debug JPEGs. Env: LOGO_DETECTOR_DEBUG_DIR */
    debugImageDir: process.env.LOGO_DETECTOR_DEBUG_DIR || path.join(backendRoot, "utils", "logo-detector"),
  },

  /**
   * Live HLS: logo-detector on stream URL + hysteresis. Set LOGO_LIVE_MATCHING_ENABLED=false to disable.
   */
  logoLiveMatching: {
    enabled: process.env.LOGO_LIVE_MATCHING_ENABLED !== "false",
    intervalMs: parseInt(process.env.LOGO_LIVE_MATCHING_INTERVAL_MS || "500", 10),
    discoveryIntervalMs: parseInt(process.env.LOGO_LIVE_DISCOVERY_INTERVAL_MS || "60000", 10),
    /** Single logo-detector run (ffmpeg + OpenCV) per live tick. Env: LOGO_LIVE_PROBE_TIMEOUT_MS */
    probeTimeoutMs: parseInt(process.env.LOGO_LIVE_PROBE_TIMEOUT_MS || "5000", 10),
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
