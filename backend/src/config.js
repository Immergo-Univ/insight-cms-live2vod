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
    /** Public editor widget uploads (bucket root segment, not under `prefix`). */
    widgetImagesPrefix: (process.env.S3_WIDGET_IMAGES_PREFIX || "widget-images").replace(/^\/+|\/+$/g, ""),
    syncIntervalMs: parseInt(process.env.CHANNEL_LOGOS_S3_SYNC_INTERVAL_MS || "60000", 10),
  };
})();

export const config = {
  insightApiBase: process.env.INSIGHT_API_BASE || "https://insight-api-stg.univtec.com",
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
   * Remote VOD encoder. Set ENCODER_SERVICE_URL to encoder-lite (http://host:3010) or
   * Immergo editorial adapter (http://immergo-api:PORT/encoder — no trailing path beyond /encoder).
   * Env: ENCODER_SERVICE_URL, SECRET (shared Bearer). ENCODER_SECRET is still accepted as an alias.
   */
  encoder: {
    serviceUrl: (process.env.ENCODER_SERVICE_URL || "").trim().replace(/\/+$/, ""),
    secret: (process.env.SECRET || process.env.ENCODER_SECRET || "").trim(),
    /** immergo | lite — informational; dispatch uses ENCODER_SERVICE_URL only */
    backend: (process.env.ENCODER_BACKEND || "lite").trim().toLowerCase(),
  },

  /** Thumbnail microservice for editor capture posters (same as frontend editor-constants). */
  thumbnailApiBase: (
    process.env.THUMBNAIL_API_BASE ||
    "https://556gh0y4oh.execute-api.us-east-1.amazonaws.com/dev/genThumbTime"
  ).trim(),

  /**
   * YouTube Data API v3 (syndication). OAuth redirect must match Google Cloud console exactly.
   * Env: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REDIRECT_URI (backend callback URL).
   * Non-empty values in `app_settings.syndication.youtube` (oauthClientId, oauthClientSecret, oauthRedirectUri) override these at runtime.
   * Optional: YOUTUBE_OAUTH_FRONTEND_REDIRECT — browser URL after success (e.g. editor with tenantId).
   * YOUTUBE_OAUTH_STATE_SECRET — HMAC for `state` (defaults to JWT_SECRET / SECRET).
   */
  youtube: {
    clientId: (process.env.YOUTUBE_CLIENT_ID || "").trim(),
    clientSecret: (process.env.YOUTUBE_CLIENT_SECRET || "").trim(),
    redirectUri: (process.env.YOUTUBE_REDIRECT_URI || "").trim(),
    oauthSuccessRedirect: (process.env.YOUTUBE_OAUTH_FRONTEND_REDIRECT || "").trim(),
    oauthStateSecret: (process.env.YOUTUBE_OAUTH_STATE_SECRET || "").trim(),
  },

  /**
   * X (Twitter) API v2 syndication. OAuth 2.0 redirect must match the X developer portal exactly.
   * Env: TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, TWITTER_REDIRECT_URI (backend callback URL).
   * Non-empty values in `app_settings.syndication.twitter` override these at runtime.
   * Optional: TWITTER_OAUTH_FRONTEND_REDIRECT, TWITTER_OAUTH_STATE_SECRET, TWITTER_ALLOW_MOCK_AUTH.
   */
  twitter: {
    clientId: (process.env.TWITTER_CLIENT_ID || "").trim(),
    clientSecret: (process.env.TWITTER_CLIENT_SECRET || "").trim(),
    redirectUri: (process.env.TWITTER_REDIRECT_URI || "").trim(),
    oauthSuccessRedirect: (process.env.TWITTER_OAUTH_FRONTEND_REDIRECT || "").trim(),
    oauthStateSecret: (process.env.TWITTER_OAUTH_STATE_SECRET || "").trim(),
  },

  /**
   * Facebook Page syndication (Meta Graph API). OAuth redirect must match Meta app settings exactly.
   * Env: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_REDIRECT_URI (backend callback URL).
   * Non-empty values in `app_settings.syndication.facebook` override these at runtime.
   * Optional: FACEBOOK_OAUTH_FRONTEND_REDIRECT, FACEBOOK_OAUTH_STATE_SECRET, FACEBOOK_ALLOW_MOCK_AUTH.
   */
  facebook: {
    appId: (process.env.FACEBOOK_APP_ID || "").trim(),
    appSecret: (process.env.FACEBOOK_APP_SECRET || "").trim(),
    redirectUri: (process.env.FACEBOOK_REDIRECT_URI || "").trim(),
    oauthSuccessRedirect: (process.env.FACEBOOK_OAUTH_FRONTEND_REDIRECT || "").trim(),
    oauthStateSecret: (process.env.FACEBOOK_OAUTH_STATE_SECRET || "").trim(),
  },

  /**
   * Instagram Business syndication (Meta Graph API). Same Meta app model as Facebook; separate env keys and callback.
   * Env: INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI.
   * Optional: INSTAGRAM_OAUTH_FRONTEND_REDIRECT, INSTAGRAM_OAUTH_STATE_SECRET, INSTAGRAM_ALLOW_MOCK_AUTH.
   */
  instagram: {
    appId: (process.env.INSTAGRAM_APP_ID || "").trim(),
    appSecret: (process.env.INSTAGRAM_APP_SECRET || "").trim(),
    redirectUri: (process.env.INSTAGRAM_REDIRECT_URI || "").trim(),
    oauthSuccessRedirect: (process.env.INSTAGRAM_OAUTH_FRONTEND_REDIRECT || "").trim(),
    oauthStateSecret: (process.env.INSTAGRAM_OAUTH_STATE_SECRET || "").trim(),
  },

  /**
   * TikTok Direct Post (Content Posting API). OAuth redirect must match TikTok developer portal exactly.
   * Env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI (backend callback URL).
   * Optional: TIKTOK_OAUTH_FRONTEND_REDIRECT, TIKTOK_OAUTH_STATE_SECRET, TIKTOK_ALLOW_MOCK_AUTH.
   * Domain verification fallback (when not configured in Admin): TIKTOK_DOMAIN_VERIFICATION_PATH,
   * TIKTOK_DOMAIN_VERIFICATION_FILE_NAME, TIKTOK_DOMAIN_VERIFICATION_FILE_CONTENT,
   * TIKTOK_DOMAIN_VERIFICATION_CONTENT_TYPE.
   */
  tiktok: {
    clientKey: (process.env.TIKTOK_CLIENT_KEY || "").trim(),
    clientSecret: (process.env.TIKTOK_CLIENT_SECRET || "").trim(),
    redirectUri: (process.env.TIKTOK_REDIRECT_URI || "").trim(),
    oauthSuccessRedirect: (process.env.TIKTOK_OAUTH_FRONTEND_REDIRECT || "").trim(),
    oauthStateSecret: (process.env.TIKTOK_OAUTH_STATE_SECRET || "").trim(),
    domainVerificationPath: (process.env.TIKTOK_DOMAIN_VERIFICATION_PATH || "").trim(),
    domainVerificationFileName: (process.env.TIKTOK_DOMAIN_VERIFICATION_FILE_NAME || "").trim(),
    domainVerificationFileContent: process.env.TIKTOK_DOMAIN_VERIFICATION_FILE_CONTENT || "",
    domainVerificationContentType: (process.env.TIKTOK_DOMAIN_VERIFICATION_CONTENT_TYPE || "text/plain; charset=utf-8").trim(),
  },

  /**
   * Admin panel (`/admin`). Requires Postgres + `JWT_SECRET`.
   * Env: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (seeded on first sync if user missing).
   */
  admin: {
    jwtSecret: (process.env.JWT_SECRET || "").trim(),
    adminEmail: (process.env.ADMIN_EMAIL || "admin@affiliates.local").trim().toLowerCase(),
    adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  },

  /**
   * VOD / clip jobs (`vod_jobs` via Sequelize). Enabled when POSTGRES_HOST and POSTGRES_DB are set.
   * Schema: `sequelize.sync()` on startup; optional `POSTGRES_SYNC_ALTER=true` for `sync({ alter: true })`.
   * Optional TLS: POSTGRES_SSL=true (rejectUnauthorized only if POSTGRES_SSL_REJECT_UNAUTHORIZED=true).
   */
  postgres: (() => {
    const host = (process.env.POSTGRES_HOST || "").trim();
    const database = (process.env.POSTGRES_DB || "").trim();
    const sslOn = process.env.POSTGRES_SSL === "true";
    return {
      enabled: Boolean(host && database),
      host,
      port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
      database,
      user: (process.env.POSTGRES_USER || "postgres").trim(),
      password: (process.env.POSTGRES_PASSWORD || "").trim(),
      poolMax: parseInt(process.env.POSTGRES_POOL_MAX || "10", 10),
      ssl: sslOn ? { rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === "true" } : undefined,
      /** When true, `sequelize.sync({ alter: true })` — can rewrite columns; use only in dev. */
      syncAlter: process.env.POSTGRES_SYNC_ALTER === "true",
    };
  })(),

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
