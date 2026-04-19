import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const encoderRoot = path.join(__dirname, "..");

/**
 * S3-compatible storage (same env contract as live2vod backend).
 */
const s3LogosResolved = (() => {
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "").trim();
  const bucket = (process.env.S3_BUCKET_NAME || "").trim();
  const endpoint = (process.env.S3_ENDPOINT || "").trim();
  const isDigitalOceanSpaces = /digitaloceanspaces\.com/i.test(endpoint);
  const region = (() => {
    if (process.env.S3_SIGNING_REGION?.trim()) return process.env.S3_SIGNING_REGION.trim();
    if (isDigitalOceanSpaces) return (process.env.S3_REGION || "us-east-1").trim();
    return (process.env.S3_REGION || process.env.AWS_REGION || "us-east-1").trim();
  })();
  const forcePathStyle =
    process.env.S3_FORCE_PATH_STYLE === "false"
      ? false
      : process.env.S3_FORCE_PATH_STYLE === "true"
        ? true
        : isDigitalOceanSpaces;
  const enabled = Boolean(accessKeyId && secretAccessKey && bucket && endpoint);
  return {
    enabled,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    region,
    forcePathStyle,
    prefix: (process.env.S3_LOGOS_PREFIX || "channel-logos").replace(/^\/+|\/+$/g, ""),
  };
})();

const widgetImagesPrefix = (process.env.S3_WIDGET_IMAGES_PREFIX || "widget-images").replace(/^\/+|\/+$/g, "");

export const config = {
  encoderRoot,
  port: parseInt(process.env.PORT || "3010", 10),
  /** Shared secret with live2vod backend (Bearer token). Env: SECRET */
  secret: (process.env.SECRET || "").trim(),
  /** Base URL of backend for PATCH /api/encoder/jobs/:id and optional poster HTTP fetch. */
  backendBaseUrl: (process.env.BACKEND_BASE_URL || "").trim().replace(/\/+$/, ""),
  s3Logos: s3LogosResolved,
  /** Bucket-relative prefix for public widget PNGs produced during encode (not under S3_LOGOS_PREFIX). Env: S3_WIDGET_IMAGES_PREFIX */
  widgetImagesPrefix,
  /** Max wait for widget image HTTP(S) and editor-poster fetch from backend. Env: VOD_WIDGET_FETCH_TIMEOUT_MS */
  vodWidgetFetchTimeoutMs: Math.max(3000, parseInt(process.env.VOD_WIDGET_FETCH_TIMEOUT_MS || "60000", 10) || 60000),
  /** Optional local mirror of editor posters (same layout as backend data/editor-posters). */
  editorPostersDataDir: (process.env.EDITOR_POSTERS_DATA_DIR || "").trim(),
};
