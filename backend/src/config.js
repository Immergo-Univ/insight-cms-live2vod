import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");

export const config = {
  insightApiBase: process.env.INSIGHT_API_BASE || "https://insight-api-frankly.univtec.com",
  port: process.env.PORT || 3001,
  insightApiUsername: process.env.INSIGHT_API_USERNAME,
  insightApiPassword: process.env.INSIGHT_API_PASSWORD,
  /** Tenants scanned by the logo/archive pipeline (same IDs as x-tenant-id / frontend). */
  tenants: ["channel14","rjr"],

  /**
   * Legacy archive pipeline (template-matching over DVR windows, backfill). Off by default.
   * Opt-in only: LOGO_SCAN_ENABLED=true — not required for live logo / ad detection.
   */
  logoScan: {
    enabled: process.env.LOGO_SCAN_ENABLED === "true",
    /** Pause between full scheduler cycles (ms). */
    cyclePauseMs: parseInt(process.env.LOGO_SCAN_CYCLE_PAUSE_MS || "45000", 10),
    /** How far back to request archive windows (hours). Ads older than this are dropped from memory. */
    archiveHours: parseInt(process.env.LOGO_SCAN_ARCHIVE_HOURS || "72", 10),
    /**
     * Deepest wall-clock history the matcher walks per channel (hours). Use the real DVR/archive depth
     * on the CDN (e.g. 12). Loop uses max(retentionCutoff, now - this) so it stays within retention too.
     */
    matcherArchiveHours: parseInt(
      process.env.LOGO_SCAN_MATCHER_ARCHIVE_HOURS || process.env.LOGO_SCAN_ARCHIVE_HOURS || "72",
      10,
    ),
    /**
     * During backfill, max successful matcher runs per channel per cycle (0 = no limit — one channel
     * pass may scan the whole matcherArchiveHours range in a single cycle).
     */
    matcherMaxRunsPerChannelPerCycle: parseInt(
      process.env.LOGO_SCAN_MATCHER_MAX_RUNS_PER_CHANNEL_PER_CYCLE || "0",
      10,
    ),
    /** Logical fragment size for processed / logo-presence bookkeeping (seconds). Matcher samples every 10s. */
    fragmentSeconds: parseInt(process.env.LOGO_SCAN_FRAGMENT_SEC || "600", 10),
    /** logo-template-matching archive window length (seconds); default 2 min per run. Override with LOGO_SCAN_MATCHER_WINDOW_SEC. */
    matcherWindowSeconds: parseInt(process.env.LOGO_SCAN_MATCHER_WINDOW_SEC || "120", 10),
    /**
     * logo-template-matching: min normalized correlation to treat sample as logo-present (lower = more
     * permissive, fewer false ad gaps). Env: LOGO_SCAN_MATCHER_THRESHOLD
     */
    matcherMatchThreshold: (() => {
      const v = parseFloat(process.env.LOGO_SCAN_MATCHER_THRESHOLD ?? "0.48");
      return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.48;
    })(),
    /**
     * Fraction of bbox w/h added as padding around the search ROI. Env: LOGO_SCAN_MATCHER_SEARCH_PAD_FRAC
     */
    matcherSearchPadFrac: (() => {
      const v = parseFloat(process.env.LOGO_SCAN_MATCHER_SEARCH_PAD_FRAC ?? "0.28");
      return Number.isFinite(v) && v >= 0 && v <= 1.5 ? v : 0.28;
    })(),
    /** UTC hour size for logo-detector multi-hour window alignment only. */
    hourSeconds: 3600,
    /** Archive window (wall-clock UTC hours) fed to logo-detector for bbox/template extraction. */
    detectorArchiveHours: parseInt(process.env.LOGO_SCAN_DETECTOR_ARCHIVE_HOURS || "3", 10),
    stateFilePath:
      process.env.LOGO_SCAN_STATE_FILE ||
      path.join(backendRoot, "data", "logo-scan-state.json"),
    logoDetectorDir: path.join(backendRoot, "utils", "logo-detector-features"),
    logoDetectorBin: path.join(backendRoot, "utils", "logo-detector-features", "logo-detector"),
    logoMatcherDir: path.join(backendRoot, "utils", "logo-template-matching"),
    logoMatcherBin: path.join(backendRoot, "utils", "logo-template-matching", "logo-template-matching"),
    detectorTimeoutMs: parseInt(process.env.LOGO_SCAN_DETECTOR_TIMEOUT_MS || "900000", 10),
    matcherTimeoutMs: parseInt(process.env.LOGO_SCAN_MATCHER_TIMEOUT_MS || "900000", 10),
    /** Reuse logo-detector JSON/JPG without re-running the binary while cache is fresh (ms). */
    detectorCacheTtlMs: parseInt(process.env.LOGO_SCAN_DETECTOR_CACHE_MS || String(24 * 3600 * 1000), 10),
  },

  /**
   * Live HLS: probe + logo presence / ad hysteresis. On by default; set LOGO_LIVE_MATCHING_ENABLED=false to disable.
   */
  logoLiveMatching: {
    enabled: process.env.LOGO_LIVE_MATCHING_ENABLED !== "false",
    intervalMs: parseInt(process.env.LOGO_LIVE_MATCHING_INTERVAL_MS || "1000", 10),
    /** Kill ffmpeg if the live grab does not finish (avoids freezing all channels). */
    ffmpegFrameTimeoutMs: parseInt(process.env.LOGO_LIVE_FFMPEG_TIMEOUT_MS || "45000", 10),
    /** How often to refresh the channel list from the API (ms). */
    discoveryIntervalMs: parseInt(process.env.LOGO_LIVE_DISCOVERY_INTERVAL_MS || "60000", 10),
    probeTimeoutMs: parseInt(process.env.LOGO_LIVE_PROBE_TIMEOUT_MS || "90000", 10),
    stateFilePath:
      process.env.LOGO_LIVE_MATCHING_STATE_FILE ||
      path.join(backendRoot, "data", "logo-live-matching-state.json"),
    /** Empty = use config.tenants */
    tenantIds: (process.env.LOGO_LIVE_TENANTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
};
