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

function mapSyndicationRouteError(e) {
  const m = e instanceof Error ? e.message : String(e);
  const err = /** @type {Error & { code?: string }} */ (e);
  if (err.code === "ACCOUNT_LIMIT_REACHED") {
    return { status: 403, message: m, code: err.code };
  }
  const status = m.includes("not available") ? 503 : 400;
  return { status, message: m };
}
import {
  getResolvedYoutubeOAuth,
  getResolvedTwitterOAuth,
  getResolvedFacebookOAuth,
  getResolvedInstagramOAuth,
  getResolvedTiktokOAuth,
} from "../services/admin-settings.service.js";
import { decodeTenantParam } from "../middleware/decode-tenant.middleware.js";

export const tenantsRouter = Router();

// Decode the `:tenantId` path segment (encrypted CryptoJS AES or plaintext) in place.
tenantsRouter.param("tenantId", decodeTenantParam);

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

function buildOAuthRedirect(baseConfig, tenantId, params) {
  const tid = String(tenantId || "").trim();
  const base = (baseConfig || "").trim();
  const entries = Object.entries({ tenantId: tid, ...params });
  if (!base) {
    const q = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
    return `/?${q.toString()}`;
  }
  try {
    if (/^https?:\/\//i.test(base)) {
      const u = new URL(base);
      for (const [k, v] of entries) u.searchParams.set(k, String(v));
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  const sep = base.includes("?") ? "&" : "?";
  const q = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  return `${base}${sep}${q}`;
}

function buildYoutubeOAuthSuccessRedirect(tenantId, outcome = "connected", accountId) {
  if (outcome === "duplicate") {
    return buildOAuthRedirect(config.youtube.oauthSuccessRedirect, tenantId, { youtubeDuplicate: "1" });
  }
  return buildOAuthRedirect(config.youtube.oauthSuccessRedirect, tenantId, { youtubeConnected: "1" });
}

function buildTwitterOAuthSuccessRedirect(tenantId, outcome = "connected") {
  if (outcome === "duplicate") {
    return buildOAuthRedirect(config.twitter.oauthSuccessRedirect, tenantId, { twitterDuplicate: "1" });
  }
  return buildOAuthRedirect(config.twitter.oauthSuccessRedirect, tenantId, { twitterConnected: "1" });
}

function buildFacebookOAuthSuccessRedirect(tenantId, outcome = "connected", accountId) {
  if (outcome === "duplicate") {
    return buildOAuthRedirect(config.facebook.oauthSuccessRedirect, tenantId, { facebookDuplicate: "1" });
  }
  const params = { facebookConnected: "1" };
  if (outcome === "pending" && accountId) {
    params.facebookPending = "1";
    params.accountId = accountId;
  }
  return buildOAuthRedirect(config.facebook.oauthSuccessRedirect, tenantId, params);
}

function buildInstagramOAuthSuccessRedirect(tenantId, outcome = "connected", accountId) {
  if (outcome === "duplicate") {
    return buildOAuthRedirect(config.instagram.oauthSuccessRedirect, tenantId, { instagramDuplicate: "1" });
  }
  const params = { instagramConnected: "1" };
  if (outcome === "pending" && accountId) {
    params.instagramPending = "1";
    params.accountId = accountId;
  }
  return buildOAuthRedirect(config.instagram.oauthSuccessRedirect, tenantId, params);
}

function buildTiktokOAuthSuccessRedirect(tenantId, outcome = "connected") {
  if (outcome === "duplicate") {
    return buildOAuthRedirect(config.tiktok.oauthSuccessRedirect, tenantId, { tiktokDuplicate: "1" });
  }
  return buildOAuthRedirect(config.tiktok.oauthSuccessRedirect, tenantId, { tiktokConnected: "1" });
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
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
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
    const result = await completeYoutubeOAuthCallback(code, state);
    res.redirect(
      302,
      buildYoutubeOAuthSuccessRedirect(result.tenantId, result.outcome, result.accountId),
    );
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
    const result = await completeTwitterOAuthCallback(code, state);
    res.redirect(
      302,
      buildTwitterOAuthSuccessRedirect(result.tenantId, result.outcome, result.accountId),
    );
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
    const result = await completeFacebookOAuthCallback(code, state);
    res.redirect(
      302,
      buildFacebookOAuthSuccessRedirect(result.tenantId, result.outcome, result.accountId),
    );
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
    const result = await completeInstagramOAuthCallback(code, state);
    res.redirect(
      302,
      buildInstagramOAuthSuccessRedirect(result.tenantId, result.outcome, result.accountId),
    );
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
    const result = await completeTiktokOAuthCallback(code, state);
    res.redirect(
      302,
      buildTiktokOAuthSuccessRedirect(result.tenantId, result.outcome, result.accountId),
    );
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
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
  }
});

tenantsRouter.post("/:tenantId/syndication/youtube/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeYoutubeSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
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
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
  }
});

tenantsRouter.post("/:tenantId/syndication/twitter/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeTwitterSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
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
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
  }
});

tenantsRouter.get("/:tenantId/syndication/facebook/pages", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const accountId = String(req.query.accountId || "").trim() || undefined;
    const pages = await listFacebookPagesForTenant(tenantId, accountId);
    res.json({ pages });
  } catch (e) {
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
  }
});

tenantsRouter.post("/:tenantId/syndication/facebook/select-page", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const pageId = String(body.pageId || "").trim();
    const accountId = String(body.accountId || "").trim() || undefined;
    if (!pageId) return res.status(400).json({ error: "pageId is required" });
    const status = await selectFacebookPageForTenant(tenantId, pageId, accountId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const err = /** @type {Error & { code?: string }} */ (e);
    if (err.code === "DUPLICATE_ACCOUNT") {
      return res.status(409).json({ error: m, code: "DUPLICATE_ACCOUNT" });
    }
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    return res.status(out.status).json(body);
  }
});

tenantsRouter.post("/:tenantId/syndication/facebook/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeFacebookSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
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
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
  }
});

tenantsRouter.get("/:tenantId/syndication/instagram/accounts", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const accountId = String(req.query.accountId || "").trim() || undefined;
    const accounts = await listInstagramAccountsForTenant(tenantId, accountId);
    if (accounts === null) return res.status(404).json({ error: "Tenant not found" });
    res.json({ accounts });
  } catch (e) {
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
  }
});

tenantsRouter.post("/:tenantId/syndication/instagram/select-account", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const businessAccountId = String(body.businessAccountId || "").trim();
    const accountId = String(body.accountId || "").trim() || undefined;
    if (!businessAccountId) return res.status(400).json({ error: "businessAccountId is required" });
    const status = await selectInstagramAccountForTenant(tenantId, businessAccountId, accountId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const err = /** @type {Error & { code?: string }} */ (e);
    if (err.code === "DUPLICATE_ACCOUNT") {
      return res.status(409).json({ error: m, code: "DUPLICATE_ACCOUNT" });
    }
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    return res.status(out.status).json(body);
  }
});

tenantsRouter.post("/:tenantId/syndication/instagram/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeInstagramSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
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
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
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
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
  }
});

tenantsRouter.post("/:tenantId/syndication/tiktok/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeTiktokSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const out = mapSyndicationRouteError(e);
    const body = out.code ? { error: out.message, code: out.code } : { error: out.message };
    res.status(out.status).json(body);
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
