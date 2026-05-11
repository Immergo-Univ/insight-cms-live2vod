import { Router } from "express";
import { ensureTenantVisited, getTenantById } from "../services/tenant-visit.service.js";
import {
  getSyndicationStatusForTenant,
  mockAuthorizeYoutubeSyndication,
  buildYoutubeAuthorizationUrl,
  completeYoutubeOAuthCallback,
} from "../services/tenant-syndication.service.js";
import { config } from "../config.js";

export const tenantsRouter = Router();

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
    const err = String(req.query.error || "").trim();
    if (err) {
      return res.status(400).send(`YouTube authorization was denied: ${err}`);
    }
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    if (!code || !state) {
      return res.status(400).send("Missing code or state from Google OAuth callback");
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
