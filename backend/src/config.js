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
  /**
   * Deprecated: AD recognition no longer uses a hardcoded tenant list. The scheduler discovers every
   * tenant with `adRecognitionEnabled === true` in the DB. Kept only for backwards-compat (unused).
   */
  tenants: [],

  backendRoot,

  /** Per-channel timeline snapshots (ads, live probe fields). */
  channelsDataDir: path.join(backendRoot, "data", "channels"),

  /**
   * Drop precalculated `ads` entries older than this (hours) when serving the timeline.
   * Env: ADS_RETENTION_HOURS
   */
  adsRetentionHours: parseInt(process.env.ADS_RETENTION_HOURS || process.env.LOGO_SCAN_ARCHIVE_HOURS || "72", 10),

  /**
   * AD recognition: periodically probes each channel's live stream against the external
   * `insight-ad-recognition` service (`/detect`). Its verdict (ad/program/black) is fed through a
   * hysteresis window to derive live ad segments. Replaces the former logo-detector pipeline.
   */
  adRecognition: {
    enabled: process.env.AD_RECOGNITION_ENABLED !== "false",
    /** Base URL of the insight-ad-recognition service, WITHOUT the trailing /detect. */
    baseUrl: (
      process.env.AD_RECOGNITION_URL ||
      "https://insight-cms-live2vod-id2z9.ondigitalocean.app/insight-cms-live2vod-insight-ad"
    )
      .trim()
      .replace(/\/+$/, ""),
    /** Shared secret expected by the detect service (?secret=). */
    secret: (process.env.AD_RECOGNITION_SECRET || "change-me").trim(),
    /** Milliseconds between probe cycles (all channels probed in parallel each cycle). */
    intervalMs: parseInt(process.env.AD_RECOGNITION_INTERVAL_MS || "2000", 10),
    /**
     * Per-request timeout for the detect call. The microservice grabs the last frame + runs OCR /
     * pHash / NLLB translation (NLLB is slow to warm up on first boot), so this budget is generous.
     * Env: AD_RECOGNITION_TIMEOUT_MS.
     */
    requestTimeoutMs: parseInt(process.env.AD_RECOGNITION_TIMEOUT_MS || "180000", 10),
    /**
     * Length (seconds) of the DVR/archive window we probe for archive-style playlists (i.e. the
     * ones that only return media when given `startTime`/`endTime`). The microservice only keeps
     * the LAST frame of this window. Env: AD_RECOGNITION_PROBE_WINDOW_SEC.
     */
    probeWindowSec: parseInt(process.env.AD_RECOGNITION_PROBE_WINDOW_SEC || "10", 10),
    /**
     * Safety margin (seconds) subtracted from `endTime` when building the archive-window URL.
     * DVR/archive origins (Akamai, `fillgaps` proxy) have a small packaging delay: if `endTime`
     * lands inside that delay, the origin returns HTTP 400 ("no segments for that window") or
     * the proxy returns 5xx. A ~30 s margin keeps us safely on the packaged side of the stream.
     * Env: AD_RECOGNITION_ARCHIVE_MARGIN_SEC.
     */
    archiveMarginSec: parseInt(process.env.AD_RECOGNITION_ARCHIVE_MARGIN_SEC || "30", 10),
    /**
     * On the first probe attempt failing with an upstream-looking error (HTTP 4xx/5xx from the
     * origin, ffmpeg "Server returned" errors), retry ONCE with a further-back window using this
     * extended margin. Helps ride out occasional packaging spikes without cascading errors.
     * Env: AD_RECOGNITION_ARCHIVE_RETRY_MARGIN_SEC.
     */
    archiveRetryMarginSec: parseInt(
      process.env.AD_RECOGNITION_ARCHIVE_RETRY_MARGIN_SEC || "120",
      10,
    ),
    /**
     * Minimum duration (seconds) for an ad window to be recorded as a segment. When an ad window
     * closes (after PROGRAM_CONFIRM_SAMPLES consecutive "program" probes), if it lasted less than
     * this it is DISCARDED — a handful of "ad" probes that are quickly followed by "program" do not
     * form an ad slot. Env: AD_RECOGNITION_MIN_AD_SEGMENT_SEC (default 60).
     */
    minAdSegmentSec: parseInt(process.env.AD_RECOGNITION_MIN_AD_SEGMENT_SEC || "60", 10),
    /**
     * Boundary-polish job: once an ad window is confirmed and closed (>= minAdSegmentSec), a
     * background job scans +/- `polishMarginSec` around each boundary at `polishFps` frames/sec to
     * refine the ad start/end to frame accuracy, then updates the stored segment.
     * Envs: AD_RECOGNITION_POLISH_ENABLED / _MARGIN_SEC / _FPS / _TIMEOUT_MS.
     */
    polishEnabled: process.env.AD_RECOGNITION_POLISH_ENABLED !== "false",
    polishMarginSec: parseInt(process.env.AD_RECOGNITION_POLISH_MARGIN_SEC || "60", 10),
    polishFps: parseInt(process.env.AD_RECOGNITION_POLISH_FPS || "4", 10),
    polishTimeoutMs: parseInt(process.env.AD_RECOGNITION_POLISH_TIMEOUT_MS || "180000", 10),
    /**
     * Optional restriction: when set, only these tenant IDs are probed (intersected with the tenants
     * that have `adRecognitionEnabled === true`). When empty, ALL enabled tenants are probed.
     */
    tenantIds: (process.env.AD_RECOGNITION_TENANTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
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
};
