import { Router } from "express";
import { ensureTenantVisited, getTenantById } from "../services/tenant-visit.service.js";
import {
  getSyndicationStatusForTenant,
  mockAuthorizeYoutubeSyndication,
  buildYoutubeAuthorizationUrl,
  completeYoutubeOAuthCallback,
} from "../services/tenant-syndication.service.js";
import { config } from "../config.js";
import { getResolvedYoutubeOAuth } from "../services/admin-settings.service.js";

export const tenantsRouter = Router();

/** Express may expose duplicate query keys as arrays; Google sends single values. */
function firstQueryString(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value).trim();
}

/**
 * Read OAuth `code` and `state` from the callback request (query string).
 *
 * @param {import("express").Request} req
 */
function readGoogleOAuthCallbackQuery(req) {
  let code = firstQueryString(req.query?.code);
  let state = firstQueryString(req.query?.state);
  if (code && state) return { code, state };

  const rawUrl = req.originalUrl || req.url || "";
  try {
    const u = new URL(rawUrl, `http://${req.headers.host || "localhost"}`);
    if (!code) code = String(u.searchParams.get("code") || "").trim();
    if (!state) state = String(u.searchParams.get("state") || "").trim();
  } catch {
    /* ignore */
  }
  return { code, state };
}

function buildYoutubeOAuthSuccessRedirect(tenantId) {
  const tid = String(tenantId || "").trim();
  const base = (config.youtube.oauthSuccessRedirect || "").trim();
  if (!base) {
    return `/?youtubeConnected=1&tenantId=${encodeURIComponent(tid)}`;
  }
  try {
    if (/^https?:\/\//i.test(base)) {
      const u = new URL(base);
      u.searchParams.set("youtubeConnected", "1");
      u.searchParams.set("tenantId", tid);
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}youtubeConnected=1&tenantId=${encodeURIComponent(tid)}`;
}

tenantsRouter.post("/ensure", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const tenantId = body.tenantId;
    const timezone = body.tz ?? body.timezone;
    const metadata = body.metadata;
    const tenant = await ensureTenantVisited({ tenantId, timezone, metadata });
    res.json({ tenant });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

/** Google redirects here (must match YOUTUBE_REDIRECT_URI). */
tenantsRouter.get("/oauth/youtube/callback", async (req, res) => {
  try {
    const err = firstQueryString(req.query?.error);
    if (err) {
      return res.status(400).send(`YouTube authorization was denied: ${err}`);
    }
    const { code, state } = readGoogleOAuthCallbackQuery(req);
    if (!code || !state) {
      const { redirectUri } = await getResolvedYoutubeOAuth();
      const hint = redirectUri
        ? `Configured redirect URI (must match Google Cloud exactly): ${redirectUri}. `
        : "";
      return res.status(400).send(
        `${hint}` +
          "Missing ?code= or ?state= on this callback URL. " +
          "If you refreshed this page or opened the link manually, start “Authorize with Google” again (the code is one-time). " +
          "Otherwise check that your reverse proxy forwards the full query string and that the OAuth client is a “Web application” type.",
      );
    }
    const tenantId = await completeYoutubeOAuthCallback(code, state);
    res.redirect(302, buildYoutubeOAuthSuccessRedirect(tenantId));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    res.status(400).send(m);
  }
});

tenantsRouter.get("/:tenantId/syndication", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await getSyndicationStatusForTenant(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 500;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId/syndication/youtube/auth-url", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const url = await buildYoutubeAuthorizationUrl(tenantId);
    res.json({ url });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.post("/:tenantId/syndication/youtube/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeYoutubeSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    res.json({ tenant });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: m });
  }
});
