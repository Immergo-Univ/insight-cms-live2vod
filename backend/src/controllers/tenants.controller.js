import { Router } from "express";
import { ensureTenantVisited, getTenantById } from "../services/tenant-visit.service.js";
import {
  getSyndicationStatusForTenant,
  mockAuthorizeYoutubeSyndication,
  buildYoutubeAuthorizationUrl,
  completeYoutubeOAuthCallback,
  mockAuthorizeTwitterSyndication,
  buildTwitterAuthorizationUrl,
  completeTwitterOAuthCallback,
  mockAuthorizeFacebookSyndication,
  buildFacebookAuthorizationUrl,
  completeFacebookOAuthCallback,
  listFacebookPagesForTenant,
  selectFacebookPageForTenant,
  mockAuthorizeInstagramSyndication,
  buildInstagramAuthorizationUrl,
  completeInstagramOAuthCallback,
  listInstagramAccountsForTenant,
  selectInstagramAccountForTenant,
  mockAuthorizeTiktokSyndication,
  buildTiktokAuthorizationUrl,
  completeTiktokOAuthCallback,
  queryTiktokCreatorInfoForTenant,
} from "../services/tenant-syndication.service.js";
import { config } from "../config.js";
import {
  getResolvedYoutubeOAuth,
  getResolvedTwitterOAuth,
  getResolvedFacebookOAuth,
  getResolvedInstagramOAuth,
  getResolvedTiktokOAuth,
} from "../services/admin-settings.service.js";

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

function buildTwitterOAuthSuccessRedirect(tenantId) {
  const tid = String(tenantId || "").trim();
  const base = (config.twitter.oauthSuccessRedirect || "").trim();
  if (!base) {
    return `/?twitterConnected=1&tenantId=${encodeURIComponent(tid)}`;
  }
  try {
    if (/^https?:\/\//i.test(base)) {
      const u = new URL(base);
      u.searchParams.set("twitterConnected", "1");
      u.searchParams.set("tenantId", tid);
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}twitterConnected=1&tenantId=${encodeURIComponent(tid)}`;
}

function buildFacebookOAuthSuccessRedirect(tenantId) {
  const tid = String(tenantId || "").trim();
  const base = (config.facebook.oauthSuccessRedirect || "").trim();
  if (!base) {
    return `/?facebookConnected=1&tenantId=${encodeURIComponent(tid)}`;
  }
  try {
    if (/^https?:\/\//i.test(base)) {
      const u = new URL(base);
      u.searchParams.set("facebookConnected", "1");
      u.searchParams.set("tenantId", tid);
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}facebookConnected=1&tenantId=${encodeURIComponent(tid)}`;
}

function buildInstagramOAuthSuccessRedirect(tenantId) {
  const tid = String(tenantId || "").trim();
  const base = (config.instagram.oauthSuccessRedirect || "").trim();
  if (!base) {
    return `/?instagramConnected=1&tenantId=${encodeURIComponent(tid)}`;
  }
  try {
    if (/^https?:\/\//i.test(base)) {
      const u = new URL(base);
      u.searchParams.set("instagramConnected", "1");
      u.searchParams.set("tenantId", tid);
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}instagramConnected=1&tenantId=${encodeURIComponent(tid)}`;
}

function buildTiktokOAuthSuccessRedirect(tenantId) {
  const tid = String(tenantId || "").trim();
  const base = (config.tiktok.oauthSuccessRedirect || "").trim();
  if (!base) {
    return `/?tiktokConnected=1&tenantId=${encodeURIComponent(tid)}`;
  }
  try {
    if (/^https?:\/\//i.test(base)) {
      const u = new URL(base);
      u.searchParams.set("tiktokConnected", "1");
      u.searchParams.set("tenantId", tid);
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}tiktokConnected=1&tenantId=${encodeURIComponent(tid)}`;
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

/** X redirects here (must match TWITTER_REDIRECT_URI). */
tenantsRouter.get("/oauth/twitter/callback", async (req, res) => {
  try {
    const err = firstQueryString(req.query?.error);
    if (err) {
      return res.status(400).send(`X authorization was denied: ${err}`);
    }
    const { code, state } = readGoogleOAuthCallbackQuery(req);
    if (!code || !state) {
      const { redirectUri } = await getResolvedTwitterOAuth();
      const hint = redirectUri
        ? `Configured redirect URI (must match X developer portal exactly): ${redirectUri}. `
        : "";
      return res.status(400).send(
        `${hint}` +
          "Missing ?code= or ?state= on this callback URL. " +
          "If you refreshed this page or opened the link manually, start authorization again (the code is one-time).",
      );
    }
    const tenantId = await completeTwitterOAuthCallback(code, state);
    res.redirect(302, buildTwitterOAuthSuccessRedirect(tenantId));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    res.status(400).send(m);
  }
});

/** Meta redirects here (must match FACEBOOK_REDIRECT_URI). */
tenantsRouter.get("/oauth/facebook/callback", async (req, res) => {
  try {
    const err = firstQueryString(req.query?.error);
    if (err) {
      return res.status(400).send(`Facebook authorization was denied: ${err}`);
    }
    const { code, state } = readGoogleOAuthCallbackQuery(req);
    if (!code || !state) {
      const { redirectUri } = await getResolvedFacebookOAuth();
      const hint = redirectUri
        ? `Configured redirect URI (must match Meta app exactly): ${redirectUri}. `
        : "";
      return res.status(400).send(
        `${hint}` +
          "Missing ?code= or ?state= on this callback URL. " +
          "If you refreshed this page or opened the link manually, start authorization again (the code is one-time).",
      );
    }
    const tenantId = await completeFacebookOAuthCallback(code, state);
    res.redirect(302, buildFacebookOAuthSuccessRedirect(tenantId));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    res.status(400).send(m);
  }
});

/** Meta redirects here (must match INSTAGRAM_REDIRECT_URI). */
tenantsRouter.get("/oauth/instagram/callback", async (req, res) => {
  try {
    const err = firstQueryString(req.query?.error);
    if (err) {
      return res.status(400).send(`Instagram authorization was denied: ${err}`);
    }
    const { code, state } = readGoogleOAuthCallbackQuery(req);
    if (!code || !state) {
      const { redirectUri } = await getResolvedInstagramOAuth();
      const hint = redirectUri
        ? `Configured redirect URI (must match Meta app exactly): ${redirectUri}. `
        : "";
      return res.status(400).send(
        `${hint}` +
          "Missing ?code= or ?state= on this callback URL. " +
          "If you refreshed this page or opened the link manually, start authorization again (the code is one-time).",
      );
    }
    const tenantId = await completeInstagramOAuthCallback(code, state);
    res.redirect(302, buildInstagramOAuthSuccessRedirect(tenantId));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    res.status(400).send(m);
  }
});

/** TikTok redirects here (must match TIKTOK_REDIRECT_URI). */
tenantsRouter.get("/oauth/tiktok/callback", async (req, res) => {
  try {
    const err = firstQueryString(req.query?.error);
    if (err) {
      return res.status(400).send(`TikTok authorization was denied: ${err}`);
    }
    const { code, state } = readGoogleOAuthCallbackQuery(req);
    if (!code || !state) {
      const { redirectUri } = await getResolvedTiktokOAuth();
      const hint = redirectUri
        ? `Configured redirect URI (must match TikTok app exactly): ${redirectUri}. `
        : "";
      return res.status(400).send(
        `${hint}` +
          "Missing ?code= or ?state= on this callback URL. " +
          "If you refreshed this page or opened the link manually, start authorization again (the code is one-time).",
      );
    }
    const tenantId = await completeTiktokOAuthCallback(code, state);
    res.redirect(302, buildTiktokOAuthSuccessRedirect(tenantId));
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

tenantsRouter.get("/:tenantId/syndication/twitter/auth-url", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const url = await buildTwitterAuthorizationUrl(tenantId);
    res.json({ url });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.post("/:tenantId/syndication/twitter/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeTwitterSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId/syndication/facebook/auth-url", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const url = await buildFacebookAuthorizationUrl(tenantId);
    res.json({ url });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId/syndication/facebook/pages", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const pages = await listFacebookPagesForTenant(tenantId);
    res.json({ pages });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.post("/:tenantId/syndication/facebook/select-page", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const pageId = String(body.pageId || "").trim();
    if (!pageId) return res.status(400).json({ error: "pageId is required" });
    const status = await selectFacebookPageForTenant(tenantId, pageId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.post("/:tenantId/syndication/facebook/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeFacebookSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId/syndication/instagram/auth-url", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const url = await buildInstagramAuthorizationUrl(tenantId);
    res.json({ url });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId/syndication/instagram/accounts", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const accounts = await listInstagramAccountsForTenant(tenantId);
    if (accounts === null) return res.status(404).json({ error: "Tenant not found" });
    res.json({ accounts });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.post("/:tenantId/syndication/instagram/select-account", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const businessAccountId = String(body.businessAccountId || "").trim();
    if (!businessAccountId) return res.status(400).json({ error: "businessAccountId is required" });
    const status = await selectInstagramAccountForTenant(tenantId, businessAccountId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.post("/:tenantId/syndication/instagram/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeInstagramSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId/syndication/tiktok/auth-url", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const url = await buildTiktokAuthorizationUrl(tenantId);
    res.json({ url });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId/syndication/tiktok/creator-info", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const creatorInfo = await queryTiktokCreatorInfoForTenant(tenantId);
    res.json({ creatorInfo });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.post("/:tenantId/syndication/tiktok/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeTiktokSyndication(tenantId);
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
