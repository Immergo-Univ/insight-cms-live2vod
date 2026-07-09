/**
 * Channel-logo stage client.
 *
 * Talks to the Python sidecar `/logo` endpoint (OpenCV) in two modes:
 *   - "detect": auto-locate the logo ROI and return a sample crop (base64) for the CMS to store.
 *   - "match": template-match the ROI of each frame against the channel's logo templates to tell
 *     whether the logo is present, and find the present->absent (program->ad) transition frame.
 *
 * Template images live as public URLs (uploaded to S3 by the CMS). This Node layer fetches them
 * (small in-memory cache keyed by URL) and passes them to the sidecar as base64, so the Python
 * side never needs outbound network / S3 credentials.
 */

import { config } from "../config.js";
import { logger } from "../utils/logger.js";

async function postJson(pathname, payload, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.sidecar.baseUrl}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logger.warn("sidecar non-2xx", { pathname, status: res.status });
      return null;
    }
    return await res.json();
  } catch (e) {
    logger.warn("sidecar request failed", { pathname, error: String(e?.message || e) });
    return null;
  } finally {
    clearTimeout(t);
  }
}

// --- Template fetch cache (URL -> base64) -----------------------------------------------------
const templateCache = new Map(); // url -> { b64, at }
const TEMPLATE_TTL_MS = 30 * 60 * 1000;

async function fetchTemplateBase64(url) {
  const cached = templateCache.get(url);
  if (cached && Date.now() - cached.at < TEMPLATE_TTL_MS) return cached.b64;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.limits.logoTemplateFetchTimeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    templateCache.set(url, { b64, at: Date.now() });
    return b64;
  } catch (e) {
    logger.warn("logo template fetch failed", { url: String(url).slice(0, 120), error: String(e?.message || e) });
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Auto-detect the logo ROI + return a sample crop (base64) over the given frames.
 * @param {string[]} framePaths
 */
export function detectLogoRoi(framePaths) {
  if (!Array.isArray(framePaths) || framePaths.length < 2) return Promise.resolve(null);
  return postJson("/logo", { frames: framePaths, mode: "detect" }, config.limits.logoTimeoutMs);
}

/**
 * Match the ROI of each frame against the channel logo templates.
 * @param {string[]} framePaths
 * @param {{x0:number,y0:number,x1:number,y1:number}} roi
 * @param {string[]} templateUrls public URLs of template crops
 */
export async function matchLogo(framePaths, roi, templateUrls) {
  if (!Array.isArray(framePaths) || framePaths.length === 0) return null;
  if (!roi || !Array.isArray(templateUrls) || templateUrls.length === 0) return null;

  const capped = templateUrls.slice(0, config.logo.maxTemplates);
  const b64s = (await Promise.all(capped.map(fetchTemplateBase64))).filter(Boolean);
  if (b64s.length === 0) return null;

  return postJson(
    "/logo",
    { frames: framePaths, mode: "match", roi, templates: b64s },
    config.limits.logoTimeoutMs,
  );
}

export default { detectLogoRoi, matchLogo };
