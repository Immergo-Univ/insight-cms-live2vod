import crypto from "crypto";
import { config } from "../config.js";
import { getResolvedTiktokOAuth } from "./admin-settings.service.js";

const DEFAULT_TTL_SECONDS = 3600;

function readProxySecret() {
  return (
    config.tiktok.oauthStateSecret ||
    config.admin.jwtSecret ||
    config.encoder.secret ||
    "tiktok-media-proxy-dev-secret"
  );
}

/**
 * @param {string} input
 */
function safeOriginFromUri(input) {
  try {
    const u = new URL(String(input || "").trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function makePayload(tenantId, jobId, exp) {
  return `${tenantId}.${jobId}.${exp}`;
}

/**
 * @param {string} tenantId
 * @param {string} jobId
 * @param {number} exp epoch seconds
 */
function signToken(tenantId, jobId, exp) {
  const payload = makePayload(tenantId, jobId, exp);
  return crypto.createHmac("sha256", readProxySecret()).update(payload).digest("base64url");
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.jobId
 * @param {number} [opts.ttlSeconds]
 */
export async function buildSignedTiktokMediaProxyUrl(opts) {
  const tenantId = String(opts.tenantId || "").trim();
  const jobId = String(opts.jobId || "").trim();
  const ttlSecondsRaw = Number(opts.ttlSeconds || DEFAULT_TTL_SECONDS);
  const ttlSeconds = Number.isFinite(ttlSecondsRaw) ? Math.max(60, Math.floor(ttlSecondsRaw)) : DEFAULT_TTL_SECONDS;
  if (!tenantId || !jobId) return null;

  let redirectUri = "";
  try {
    const resolved = await getResolvedTiktokOAuth();
    redirectUri = String(resolved.redirectUri || "").trim();
  } catch {
    redirectUri = "";
  }
  const origin = safeOriginFromUri(redirectUri) || safeOriginFromUri(config.tiktok.redirectUri);
  if (!origin) return null;

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signToken(tenantId, jobId, exp);
  const pathTenant = encodeURIComponent(tenantId);
  const pathJob = encodeURIComponent(jobId);
  return `${origin}/tiktok/${pathTenant}/${pathJob}.mp4?exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.jobId
 * @param {string} opts.exp
 * @param {string} opts.sig
 */
export function isValidTiktokMediaProxySignature(opts) {
  const tenantId = String(opts.tenantId || "").trim();
  const jobId = String(opts.jobId || "").trim();
  const exp = Number.parseInt(String(opts.exp || ""), 10);
  const sig = String(opts.sig || "").trim();
  if (!tenantId || !jobId || !sig || !Number.isFinite(exp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return false;
  const expected = signToken(tenantId, jobId, exp);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
