import crypto from "crypto";
import { Readable } from "node:stream";
import { google } from "googleapis";
import { getSequelize } from "../db/sequelize.js";
import { config } from "../config.js";
import {
  getResolvedYoutubeOAuth,
  getResolvedTwitterOAuth,
  getResolvedFacebookOAuth,
  getResolvedInstagramOAuth,
  getResolvedTiktokOAuth,
  getTiktokSyndicationDefaults,
} from "./admin-settings.service.js";

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
}

function oauthStateSecret() {
  return (
    String(
      config.youtube.oauthStateSecret ||
        config.admin.jwtSecret ||
        config.encoder.secret ||
        "dev-insecure",
    ).trim() || "dev-insecure"
  );
}

/**
 * @param {string} tenantId
 */
export function signYoutubeOAuthState(tenantId) {
  const id = String(tenantId || "").trim();
  const exp = Date.now() + 15 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ tid: id, exp }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", oauthStateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * @param {string} state
 * @returns {string|null} tenantId
 */
export function verifyYoutubeOAuthState(state) {
  const raw = String(state || "").trim();
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = crypto.createHmac("sha256", oauthStateSecret()).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data.tid !== "string" || typeof data.exp !== "number") return null;
    if (Date.now() > data.exp) return null;
    return data.tid.trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} tenantId
 * @returns {Promise<{ youtube: object, twitter: object, facebook: object, instagram: object, tiktok: object } | null>}
 */
export async function getSyndicationStatusForTenant(tenantId) {
  const { Tenant } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  const plain = row.get({ plain: true });
  const hasYt = Boolean(plain.youtubeRefreshToken && String(plain.youtubeRefreshToken).trim());
  const hasTw = Boolean(plain.twitterRefreshToken && String(plain.twitterRefreshToken).trim());
  const hasFbUser = Boolean(plain.facebookUserAccessToken && String(plain.facebookUserAccessToken).trim());
  const pageId = typeof plain.facebookPageId === "string" && plain.facebookPageId.trim() ? plain.facebookPageId.trim() : null;
  const pageName =
    typeof plain.facebookPageName === "string" && plain.facebookPageName.trim() ? plain.facebookPageName.trim() : null;
  const hasFbPage = Boolean(plain.facebookPageAccessToken && String(plain.facebookPageAccessToken).trim());
  const hasIgUser = Boolean(plain.instagramUserAccessToken && String(plain.instagramUserAccessToken).trim());
  const igBusinessId =
    typeof plain.instagramBusinessAccountId === "string" && plain.instagramBusinessAccountId.trim()
      ? plain.instagramBusinessAccountId.trim()
      : null;
  const igUsername =
    typeof plain.instagramUsername === "string" && plain.instagramUsername.trim()
      ? plain.instagramUsername.trim()
      : null;
  const hasIgPageToken = Boolean(plain.instagramPageAccessToken && String(plain.instagramPageAccessToken).trim());
  const hasTiktok = Boolean(plain.tiktokRefreshToken && String(plain.tiktokRefreshToken).trim());
  const tiktokUsername =
    typeof plain.tiktokUsername === "string" && plain.tiktokUsername.trim() ? plain.tiktokUsername.trim() : null;
  return {
    youtube: {
      connected: hasYt || plain.syndicationYoutubeConnected === true,
      mockAuthAvailable: process.env.YOUTUBE_ALLOW_MOCK_AUTH === "true",
    },
    twitter: {
      connected: hasTw || plain.syndicationTwitterConnected === true,
      mockAuthAvailable: process.env.TWITTER_ALLOW_MOCK_AUTH === "true",
    },
    facebook: {
      connected: hasFbUser || plain.syndicationFacebookConnected === true,
      pageSelected: Boolean(pageId && hasFbPage),
      pageId,
      pageName,
      mockAuthAvailable: process.env.FACEBOOK_ALLOW_MOCK_AUTH === "true",
    },
    instagram: {
      connected: hasIgUser || plain.syndicationInstagramConnected === true,
      accountSelected: Boolean(igBusinessId && hasIgPageToken),
      businessAccountId: igBusinessId,
      username: igUsername,
      mockAuthAvailable: process.env.INSTAGRAM_ALLOW_MOCK_AUTH === "true",
    },
    tiktok: {
      connected: hasTiktok || plain.syndicationTiktokConnected === true,
      username: tiktokUsername,
      mockAuthAvailable: process.env.TIKTOK_ALLOW_MOCK_AUTH === "true",
    },
  };
}

/**
 * @param {string} tenantId
 * @returns {Promise<string>} Google OAuth URL
 */
export async function buildYoutubeAuthorizationUrl(tenantId) {
  const id = String(tenantId || "").trim();
  const { clientId, clientSecret, redirectUri } = await getResolvedYoutubeOAuth();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "YouTube OAuth is not configured: set Client ID, Client secret, and Redirect URI in Admin → Settings → Syndication → YouTube, or set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI on the backend.",
    );
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const state = signYoutubeOAuthState(id);
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    /** Ensure authorization code is returned in the query string (visible to the server), not in the URL hash. */
    response_type: "code",
    response_mode: "query",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    state,
    include_granted_scopes: true,
  });
}

/**
 * @param {string} code
 * @param {string} state
 */
export async function completeYoutubeOAuthCallback(code, state) {
  const tenantId = verifyYoutubeOAuthState(state);
  if (!tenantId) throw new Error("Invalid or expired OAuth state");

  const { clientId, clientSecret, redirectUri } = await getResolvedYoutubeOAuth();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("YouTube OAuth is not configured");
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth2Client.getToken(String(code || "").trim());
  const refresh = tokens.refresh_token || tokens.access_token;
  if (!refresh) {
    throw new Error("Google did not return a refresh token; revoke app access in Google account and try again with prompt=consent");
  }

  const { Tenant } = models();
  const row = await Tenant.findByPk(tenantId);
  if (!row) throw new Error("Tenant not found");
  if (tokens.refresh_token) {
    row.youtubeRefreshToken = tokens.refresh_token;
  }
  row.syndicationYoutubeConnected = true;
  await row.save();
  return tenantId;
}

/**
 * Mock OAuth: marks YouTube as connected for the tenant (no Google) when YOUTUBE_ALLOW_MOCK_AUTH=true.
 *
 * @param {string} tenantId
 */
export async function mockAuthorizeYoutubeSyndication(tenantId) {
  if (process.env.YOUTUBE_ALLOW_MOCK_AUTH !== "true") {
    throw new Error("Mock authorize disabled; use Google OAuth or set YOUTUBE_ALLOW_MOCK_AUTH=true for local dev");
  }
  const { Tenant } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.syndicationYoutubeConnected = true;
  await row.save();
  return getSyndicationStatusForTenant(id);
}

/**
 * @param {string} tenantId
 * @returns {Promise<string | null>}
 */
export async function getTenantYoutubeRefreshToken(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  const t = row.get("youtubeRefreshToken");
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * Upload encoded MP4 to YouTube using tenant refresh token.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.videoUrl HTTP(S) URL to MP4
 * @param {object} opts.snippet YouTube snippet
 * @param {object} opts.status YouTube status
 * @param {boolean} [opts.notifySubscribers]
 */
export async function uploadVideoToYoutube(opts) {
  const { tenantId, videoUrl, snippet, status, notifySubscribers = false } = opts;
  const refresh = await getTenantYoutubeRefreshToken(tenantId);
  if (!refresh) throw new Error("Tenant has no YouTube refresh token");

  const { clientId, clientSecret, redirectUri } = await getResolvedYoutubeOAuth();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refresh });

  const yt = google.youtube({ version: "v3", auth: oauth2Client });
  const resVideo = await fetch(String(videoUrl));
  if (!resVideo.ok) throw new Error(`Failed to download encoded video: ${resVideo.status}`);
  if (!resVideo.body) throw new Error("Video response has no body");
  // @ts-ignore — Readable.fromWeb exists in Node 18+
  const body = Readable.fromWeb(resVideo.body);

  const insert = await yt.videos.insert(
    {
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: String(snippet?.title || "Untitled").slice(0, 100),
          description: String(snippet?.description || "").slice(0, 5000),
          tags: Array.isArray(snippet?.tags)
            ? snippet.tags.map((/** @type {unknown} */ t) => String(t).slice(0, 30)).slice(0, 30)
            : undefined,
          categoryId: snippet?.categoryId ? String(snippet.categoryId) : "22",
          defaultLanguage: snippet?.defaultLanguage ? String(snippet.defaultLanguage) : undefined,
          defaultAudioLanguage: snippet?.defaultAudioLanguage ? String(snippet.defaultAudioLanguage) : undefined,
        },
        status: {
          privacyStatus:
            status?.privacyStatus === "public" ||
            status?.privacyStatus === "private" ||
            status?.privacyStatus === "unlisted"
              ? status.privacyStatus
              : "private",
          embeddable: status?.embeddable !== false,
          license: status?.license === "creativeCommon" ? "creativeCommon" : "youtube",
          publicStatsViewable: status?.publicStatsViewable !== false,
          selfDeclaredMadeForKids: Boolean(status?.selfDeclaredMadeForKids),
        },
      },
      media: {
        body,
      },
    },
    { params: { notifySubscribers: notifySubscribers ? "true" : "false" } },
  );

  const id = insert?.data?.id;
  if (!id) throw new Error("YouTube API returned no video id");
  return { videoId: id, url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` };
}

// --- X (Twitter) OAuth 2.0 + video syndication (mirrors YouTube flow in this module) ---

const TWITTER_AUTH = "https://x.com/i/oauth2/authorize";
const TWITTER_TOKEN = "https://api.twitter.com/2/oauth2/token";
// OAuth 2.0 user tokens require the v2 media upload endpoint (v1.1 returns 403 with empty body).
const TWITTER_UPLOAD = "https://api.x.com/2/media/upload";
const TWITTER_TWEETS = "https://api.x.com/2/tweets";
const TWITTER_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"].join(" ");

function twitterMediaUploadId(json) {
  return json?.data?.id ?? json?.media_id_string ?? json?.media_id ?? null;
}

function twitterMediaProcessingInfo(json) {
  return json?.data?.processing_info ?? json?.processing_info ?? null;
}

function twitterOauthStateSecret() {
  return (
    String(
      config.twitter.oauthStateSecret ||
        config.youtube.oauthStateSecret ||
        config.admin.jwtSecret ||
        config.encoder.secret ||
        "dev-insecure",
    ).trim() || "dev-insecure"
  );
}

/**
 * @param {string} tenantId
 * @param {string} codeVerifier PKCE code_verifier (43–128 chars recommended)
 */
export function signTwitterOAuthState(tenantId, codeVerifier) {
  const id = String(tenantId || "").trim();
  const cv = String(codeVerifier || "").trim();
  if (!id || !cv) throw new Error("Invalid Twitter OAuth state inputs");
  const exp = Date.now() + 15 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ p: "tw", tid: id, exp, cv }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", twitterOauthStateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * @param {string} state
 * @returns {{ tenantId: string; codeVerifier: string } | null}
 */
export function verifyTwitterOAuthState(state) {
  const raw = String(state || "").trim();
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = crypto.createHmac("sha256", twitterOauthStateSecret()).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || data.p !== "tw" || typeof data.tid !== "string" || typeof data.exp !== "number" || typeof data.cv !== "string") {
      return null;
    }
    if (Date.now() > data.exp) return null;
    const tid = data.tid.trim();
    const cv = data.cv.trim();
    if (!tid || !cv) return null;
    return { tenantId: tid, codeVerifier: cv };
  } catch {
    return null;
  }
}

function twitterPkceChallenge(codeVerifier) {
  const hash = crypto.createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
  return hash.replace(/=+$/, "");
}

/**
 * @param {string} tenantId
 * @returns {Promise<string>} X authorization URL
 */
export async function buildTwitterAuthorizationUrl(tenantId) {
  const id = String(tenantId || "").trim();
  const { clientId, clientSecret, redirectUri } = await getResolvedTwitterOAuth();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "X / Twitter OAuth is not configured: set Client ID, Client secret, and Redirect URI in Admin → Settings → Syndication → Twitter / X, or set TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, and TWITTER_REDIRECT_URI on the backend.",
    );
  }
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = twitterPkceChallenge(codeVerifier);
  const state = signTwitterOAuthState(id, codeVerifier);
  const u = new URL(TWITTER_AUTH);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", TWITTER_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function twitterTokenRequest(bodyParams, clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const body = new URLSearchParams(bodyParams);
  const res = await fetch(TWITTER_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error_description || json?.error || text || res.statusText;
    throw new Error(`Twitter token endpoint failed: ${res.status} ${String(msg).slice(0, 500)}`);
  }
  return json;
}

/**
 * @param {string} code
 * @param {string} state
 */
export async function completeTwitterOAuthCallback(code, state) {
  const parsed = verifyTwitterOAuthState(state);
  if (!parsed) throw new Error("Invalid or expired OAuth state");

  const { clientId, clientSecret, redirectUri } = await getResolvedTwitterOAuth();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("X / Twitter OAuth is not configured");
  }

  const json = await twitterTokenRequest(
    {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code: String(code || "").trim(),
      code_verifier: parsed.codeVerifier,
    },
    clientId,
    clientSecret,
  );

  const refresh = json.refresh_token || json.access_token;
  if (!refresh) {
    throw new Error("X did not return a refresh token; ensure scope offline.access and re-authorize the app");
  }

  const { Tenant } = models();
  const row = await Tenant.findByPk(parsed.tenantId);
  if (!row) throw new Error("Tenant not found");
  if (json.refresh_token) {
    row.twitterRefreshToken = json.refresh_token;
  }
  row.syndicationTwitterConnected = true;
  await row.save();
  return parsed.tenantId;
}

/**
 * Mock OAuth: marks X as connected when TWITTER_ALLOW_MOCK_AUTH=true.
 *
 * @param {string} tenantId
 */
export async function mockAuthorizeTwitterSyndication(tenantId) {
  if (process.env.TWITTER_ALLOW_MOCK_AUTH !== "true") {
    throw new Error("Mock authorize disabled; use X OAuth or set TWITTER_ALLOW_MOCK_AUTH=true for local dev");
  }
  const { Tenant } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.syndicationTwitterConnected = true;
  await row.save();
  return getSyndicationStatusForTenant(id);
}

/**
 * @param {string} tenantId
 * @returns {Promise<string | null>}
 */
export async function getTenantTwitterRefreshToken(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  const t = row.get("twitterRefreshToken");
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * @param {string} tenantId
 * @returns {Promise<string>} user access token
 */
export async function getTwitterAccessTokenForTenant(tenantId) {
  const refresh = await getTenantTwitterRefreshToken(tenantId);
  if (!refresh) throw new Error("Tenant has no X refresh token");

  const { clientId, clientSecret } = await getResolvedTwitterOAuth();
  if (!clientId || !clientSecret) throw new Error("X / Twitter OAuth is not configured");

  const json = await twitterTokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
    },
    clientId,
    clientSecret,
  );
  const access = json.access_token;
  if (!access || typeof access !== "string") {
    throw new Error("X token refresh did not return access_token");
  }
  return access.trim();
}

/**
 * Upload encoded MP4 to X as a video tweet using tenant refresh token.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.videoUrl HTTP(S) URL to MP4
 * @param {string} opts.text Tweet text (max 280 chars for legacy length)
 */
export async function uploadVideoToTwitter(opts) {
  const { tenantId, videoUrl, text } = opts;
  const access = await getTwitterAccessTokenForTenant(tenantId);

  const resVideo = await fetch(String(videoUrl));
  if (!resVideo.ok) throw new Error(`Failed to download encoded video: ${resVideo.status}`);
  const buf = Buffer.from(await resVideo.arrayBuffer());
  const totalBytes = buf.length;
  if (totalBytes < 1) throw new Error("Encoded video is empty");

  const initBody = new FormData();
  initBody.set("command", "INIT");
  initBody.set("total_bytes", String(totalBytes));
  initBody.set("media_type", "video/mp4");
  initBody.set("media_category", "tweet_video");
  const initRes = await fetch(TWITTER_UPLOAD, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}` },
    body: initBody,
  });
  const initText = await initRes.text();
  let initJson;
  try {
    initJson = JSON.parse(initText);
  } catch {
    initJson = { raw: initText };
  }
  if (!initRes.ok) {
    throw new Error(`Twitter media INIT failed: ${initRes.status} ${JSON.stringify(initJson).slice(0, 400)}`);
  }
  const mediaId = twitterMediaUploadId(initJson);
  if (!mediaId) throw new Error("Twitter media INIT returned no media_id");

  const chunkSize = 2 * 1024 * 1024;
  let segmentIndex = 0;
  for (let offset = 0; offset < totalBytes; offset += chunkSize) {
    const chunk = buf.subarray(offset, Math.min(offset + chunkSize, totalBytes));
    const fd = new FormData();
    fd.set("command", "APPEND");
    fd.set("media_id", String(mediaId));
    fd.set("segment_index", String(segmentIndex));
    fd.set("media", new Blob([chunk]), "blob");
    const apRes = await fetch(TWITTER_UPLOAD, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}` },
      body: fd,
    });
    if (!apRes.ok) {
      const t = await apRes.text();
      throw new Error(`Twitter media APPEND failed: ${apRes.status} ${t.slice(0, 400)}`);
    }
    segmentIndex += 1;
  }

  const finBody = new FormData();
  finBody.set("command", "FINALIZE");
  finBody.set("media_id", String(mediaId));
  const finRes = await fetch(TWITTER_UPLOAD, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}` },
    body: finBody,
  });
  const finJson = await finRes.json().catch(() => ({}));
  if (!finRes.ok) {
    throw new Error(`Twitter media FINALIZE failed: ${finRes.status} ${JSON.stringify(finJson).slice(0, 400)}`);
  }

  const processing = twitterMediaProcessingInfo(finJson);
  if (processing && processing.state && processing.state !== "succeeded") {
    const deadline = Date.now() + 5 * 60 * 1000;
    let waitMs = parseInt(String(processing.check_after_secs || "2"), 10) * 1000 || 2000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 15000)));
      const statusUrl = new URL(TWITTER_UPLOAD);
      statusUrl.searchParams.set("command", "STATUS");
      statusUrl.searchParams.set("media_id", String(mediaId));
      const stRes = await fetch(statusUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${access}` },
      });
      const stJson = await stRes.json().catch(() => ({}));
      const stInfo = twitterMediaProcessingInfo(stJson);
      const st = stInfo?.state;
      if (st === "succeeded") break;
      if (st === "failed") {
        const err = stInfo?.error || stJson;
        throw new Error(`Twitter media processing failed: ${JSON.stringify(err).slice(0, 400)}`);
      }
      waitMs = parseInt(String(stInfo?.check_after_secs || "2"), 10) * 1000 || 2000;
    }
  }

  const tweetText = String(text || " ").trim().slice(0, 280) || " ";
  const twRes = await fetch(TWITTER_TWEETS, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access}`,
    },
    body: JSON.stringify({ text: tweetText, media: { media_ids: [String(mediaId)] } }),
  });
  const twJson = await twRes.json().catch(() => ({}));
  if (!twRes.ok) {
    throw new Error(`Twitter POST /2/tweets failed: ${twRes.status} ${JSON.stringify(twJson).slice(0, 500)}`);
  }
  const tweetId = twJson.data?.id;
  if (!tweetId) throw new Error("Twitter API returned no tweet id");
  const url = `https://x.com/i/web/status/${encodeURIComponent(tweetId)}`;
  return { tweetId: String(tweetId), url };
}

// --- Facebook Page syndication (Meta Graph API) ---

const FACEBOOK_GRAPH = "https://graph.facebook.com/v21.0";
const FACEBOOK_DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";
const FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"].join(",");

function facebookOauthStateSecret() {
  return (
    String(
      config.facebook.oauthStateSecret ||
        config.twitter.oauthStateSecret ||
        config.youtube.oauthStateSecret ||
        config.admin.jwtSecret ||
        config.encoder.secret ||
        "dev-insecure",
    ).trim() || "dev-insecure"
  );
}

/**
 * @param {string} tenantId
 */
export function signFacebookOAuthState(tenantId) {
  const id = String(tenantId || "").trim();
  const exp = Date.now() + 15 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ p: "fb", tid: id, exp }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", facebookOauthStateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * @param {string} state
 * @returns {string|null} tenantId
 */
export function verifyFacebookOAuthState(state) {
  const raw = String(state || "").trim();
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = crypto.createHmac("sha256", facebookOauthStateSecret()).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || data.p !== "fb" || typeof data.tid !== "string" || typeof data.exp !== "number") return null;
    if (Date.now() > data.exp) return null;
    return data.tid.trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} pathWithQuery
 * @returns {Promise<Record<string, unknown>>}
 */
async function facebookGraphGet(pathWithQuery) {
  const res = await fetch(`${FACEBOOK_GRAPH}${pathWithQuery}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error;
    const msg = err?.message || JSON.stringify(json).slice(0, 400);
    throw new Error(`Facebook Graph API failed: ${res.status} ${msg}`);
  }
  return /** @type {Record<string, unknown>} */ (json);
}

/**
 * @param {string} tenantId
 * @returns {Promise<string>} Facebook OAuth URL
 */
export async function buildFacebookAuthorizationUrl(tenantId) {
  const id = String(tenantId || "").trim();
  const { clientId, clientSecret, redirectUri } = await getResolvedFacebookOAuth();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Facebook OAuth is not configured: set App ID, App secret, and Redirect URI in Admin → Settings → Syndication → Facebook, or set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and FACEBOOK_REDIRECT_URI on the backend.",
    );
  }
  const state = signFacebookOAuthState(id);
  const u = new URL(FACEBOOK_DIALOG);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", FACEBOOK_SCOPES);
  u.searchParams.set("response_type", "code");
  return u.toString();
}

/**
 * Exchange authorization code for a long-lived user access token.
 *
 * @param {string} code
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string} redirectUri
 */
async function facebookExchangeCodeForLongLivedToken(code, clientId, clientSecret, redirectUri) {
  const shortParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code: String(code || "").trim(),
  });
  const shortJson = await facebookGraphGet(`/oauth/access_token?${shortParams.toString()}`);
  const shortToken = shortJson.access_token;
  if (!shortToken || typeof shortToken !== "string") {
    throw new Error("Facebook did not return a short-lived access token");
  }
  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortToken,
  });
  const longJson = await facebookGraphGet(`/oauth/access_token?${longParams.toString()}`);
  const longToken = longJson.access_token;
  if (!longToken || typeof longToken !== "string") {
    throw new Error("Facebook did not return a long-lived access token");
  }
  return longToken.trim();
}

/**
 * @param {string} code
 * @param {string} state
 */
export async function completeFacebookOAuthCallback(code, state) {
  const tenantId = verifyFacebookOAuthState(state);
  if (!tenantId) throw new Error("Invalid or expired OAuth state");

  const { clientId, clientSecret, redirectUri } = await getResolvedFacebookOAuth();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Facebook OAuth is not configured");
  }

  const longToken = await facebookExchangeCodeForLongLivedToken(code, clientId, clientSecret, redirectUri);

  const { Tenant } = models();
  const row = await Tenant.findByPk(tenantId);
  if (!row) throw new Error("Tenant not found");
  row.facebookUserAccessToken = longToken;
  row.syndicationFacebookConnected = true;
  row.facebookPageId = null;
  row.facebookPageAccessToken = null;
  row.facebookPageName = null;
  await row.save();
  return tenantId;
}

/**
 * @param {string} tenantId
 */
export async function mockAuthorizeFacebookSyndication(tenantId) {
  if (process.env.FACEBOOK_ALLOW_MOCK_AUTH !== "true") {
    throw new Error("Mock authorize disabled; use Facebook OAuth or set FACEBOOK_ALLOW_MOCK_AUTH=true for local dev");
  }
  const { Tenant } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.syndicationFacebookConnected = true;
  row.facebookUserAccessToken = "mock-facebook-user-token";
  row.facebookPageId = "mock-page-id";
  row.facebookPageAccessToken = "mock-page-token";
  row.facebookPageName = "Mock Facebook Page";
  await row.save();
  return getSyndicationStatusForTenant(id);
}

/**
 * @param {string} tenantId
 * @returns {Promise<string | null>}
 */
export async function getTenantFacebookUserAccessToken(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  const t = row.get("facebookUserAccessToken");
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * @param {string} tenantId
 * @returns {Promise<Array<{ id: string; name: string }>>}
 */
export async function listFacebookPagesForTenant(tenantId) {
  const userToken = await getTenantFacebookUserAccessToken(tenantId);
  if (!userToken) throw new Error("Tenant has no Facebook user access token");

  if (userToken === "mock-facebook-user-token") {
    return [{ id: "mock-page-id", name: "Mock Facebook Page" }];
  }

  const json = await facebookGraphGet(
    `/me/accounts?fields=id,name&access_token=${encodeURIComponent(userToken)}`,
  );
  const data = Array.isArray(json.data) ? json.data : [];
  return data
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      const id = String(/** @type {{ id?: string }} */ (p).id || "").trim();
      const name = String(/** @type {{ name?: string }} */ (p).name || id).trim();
      return id ? { id, name: name || id } : null;
    })
    .filter(Boolean);
}

/**
 * @param {string} tenantId
 * @param {string} pageId
 */
export async function selectFacebookPageForTenant(tenantId, pageId) {
  const id = String(tenantId || "").trim();
  const pid = String(pageId || "").trim();
  if (!id || !pid) throw new Error("tenantId and pageId are required");

  const userToken = await getTenantFacebookUserAccessToken(id);
  if (!userToken) throw new Error("Tenant has no Facebook user access token");

  let pageName = pid;
  let pageAccessToken = userToken;

  if (userToken === "mock-facebook-user-token") {
    if (pid !== "mock-page-id") throw new Error("Invalid mock page id");
    pageName = "Mock Facebook Page";
    pageAccessToken = "mock-page-token";
  } else {
    const json = await facebookGraphGet(
      `/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`,
    );
    const data = Array.isArray(json.data) ? json.data : [];
    const match = data.find(
      (p) => p && typeof p === "object" && String(/** @type {{ id?: string }} */ (p).id || "").trim() === pid,
    );
    if (!match || typeof match !== "object") {
      throw new Error("Facebook Page not found for this account");
    }
    pageName = String(/** @type {{ name?: string }} */ (match).name || pid).trim() || pid;
    const pat = /** @type {{ access_token?: string }} */ (match).access_token;
    if (!pat || typeof pat !== "string" || !pat.trim()) {
      throw new Error("Facebook did not return a page access token");
    }
    pageAccessToken = pat.trim();
  }

  const { Tenant } = models();
  const row = await Tenant.findByPk(id);
  if (!row) throw new Error("Tenant not found");
  row.facebookPageId = pid;
  row.facebookPageAccessToken = pageAccessToken;
  row.facebookPageName = pageName;
  await row.save();
  return getSyndicationStatusForTenant(id);
}

/**
 * @param {string} tenantId
 * @returns {Promise<{ pageId: string; pageAccessToken: string }>}
 */
async function getTenantFacebookPageCredentials(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) throw new Error("Tenant not found");
  const pageId = row.get("facebookPageId");
  const pageToken = row.get("facebookPageAccessToken");
  const pid = typeof pageId === "string" && pageId.trim() ? pageId.trim() : "";
  const pt = typeof pageToken === "string" && pageToken.trim() ? pageToken.trim() : "";
  if (!pid || !pt) throw new Error("Tenant has no Facebook Page selected");
  return { pageId: pid, pageAccessToken: pt };
}

/**
 * Upload encoded MP4 to a Facebook Page using the page access token.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.videoUrl HTTP(S) URL to MP4 (must be reachable by Meta)
 * @param {string} opts.title
 * @param {string} opts.description
 */
export async function uploadVideoToFacebook(opts) {
  const { tenantId, videoUrl, title, description } = opts;
  const { pageId, pageAccessToken } = await getTenantFacebookPageCredentials(tenantId);

  if (pageAccessToken === "mock-page-token") {
    return {
      postId: "mock-fb-video-id",
      url: `https://www.facebook.com/mock-fb-video-id`,
    };
  }

  const body = new URLSearchParams({
    file_url: String(videoUrl).trim(),
    title: String(title || "Untitled").slice(0, 255),
    description: String(description || "").slice(0, 5000),
    access_token: pageAccessToken,
  });

  const res = await fetch(`${FACEBOOK_GRAPH}/${encodeURIComponent(pageId)}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error;
    const msg = err?.message || JSON.stringify(json).slice(0, 500);
    throw new Error(`Facebook video upload failed: ${res.status} ${msg}`);
  }
  const postId = json.id;
  if (!postId) throw new Error("Facebook API returned no video id");
  const idStr = String(postId);
  return {
    postId: idStr,
    url: `https://www.facebook.com/${encodeURIComponent(idStr)}`,
  };
}

// --- Instagram Business syndication (Meta Graph API) ---

const META_GRAPH = "https://graph.facebook.com/v21.0";
const META_DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";
const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
].join(",");

function instagramOauthStateSecret() {
  return (
    String(
      config.instagram.oauthStateSecret ||
        config.facebook.oauthStateSecret ||
        config.twitter.oauthStateSecret ||
        config.youtube.oauthStateSecret ||
        config.admin.jwtSecret ||
        config.encoder.secret ||
        "dev-insecure",
    ).trim() || "dev-insecure"
  );
}

/**
 * @param {string} tenantId
 */
export function signInstagramOAuthState(tenantId) {
  const id = String(tenantId || "").trim();
  const exp = Date.now() + 15 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ p: "ig", tid: id, exp }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", instagramOauthStateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * @param {string} state
 * @returns {string|null} tenantId
 */
export function verifyInstagramOAuthState(state) {
  const raw = String(state || "").trim();
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = crypto.createHmac("sha256", instagramOauthStateSecret()).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || data.p !== "ig" || typeof data.tid !== "string" || typeof data.exp !== "number") return null;
    if (Date.now() > data.exp) return null;
    return data.tid.trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} pathWithQuery
 * @returns {Promise<Record<string, unknown>>}
 */
async function metaGraphGet(pathWithQuery) {
  const res = await fetch(`${META_GRAPH}${pathWithQuery}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error;
    const msg = err?.message || JSON.stringify(json).slice(0, 400);
    throw new Error(`Meta Graph API failed: ${res.status} ${msg}`);
  }
  return /** @type {Record<string, unknown>} */ (json);
}

/**
 * @param {string} pathWithQuery
 * @param {URLSearchParams} body
 * @returns {Promise<Record<string, unknown>>}
 */
async function metaGraphPostForm(pathWithQuery, body) {
  const res = await fetch(`${META_GRAPH}${pathWithQuery}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error;
    const msg = err?.message || JSON.stringify(json).slice(0, 500);
    throw new Error(`Meta Graph API POST failed: ${res.status} ${msg}`);
  }
  return /** @type {Record<string, unknown>} */ (json);
}

async function instagramExchangeCodeForLongLivedToken(code, clientId, clientSecret, redirectUri) {
  const shortParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code: String(code || "").trim(),
  });
  const shortJson = await metaGraphGet(`/oauth/access_token?${shortParams.toString()}`);
  const shortToken = shortJson.access_token;
  if (!shortToken || typeof shortToken !== "string") {
    throw new Error("Instagram OAuth did not return a short-lived access token");
  }
  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortToken,
  });
  const longJson = await metaGraphGet(`/oauth/access_token?${longParams.toString()}`);
  const longToken = longJson.access_token;
  if (!longToken || typeof longToken !== "string") {
    throw new Error("Instagram OAuth did not return a long-lived access token");
  }
  return longToken.trim();
}

/**
 * @param {string} tenantId
 * @returns {Promise<string>} Meta OAuth URL
 */
export async function buildInstagramAuthorizationUrl(tenantId) {
  const id = String(tenantId || "").trim();
  const { clientId, clientSecret, redirectUri } = await getResolvedInstagramOAuth();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Instagram OAuth is not configured: set App ID, App secret, and Redirect URI in Admin → Settings → Syndication → Instagram, or set INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, and INSTAGRAM_REDIRECT_URI on the backend.",
    );
  }
  const state = signInstagramOAuthState(id);
  const u = new URL(META_DIALOG);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", INSTAGRAM_SCOPES);
  u.searchParams.set("response_type", "code");
  return u.toString();
}

/**
 * @param {string} code
 * @param {string} state
 */
export async function completeInstagramOAuthCallback(code, state) {
  const tenantId = verifyInstagramOAuthState(state);
  if (!tenantId) throw new Error("Invalid or expired OAuth state");

  const { clientId, clientSecret, redirectUri } = await getResolvedInstagramOAuth();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Instagram OAuth is not configured");
  }

  const longToken = await instagramExchangeCodeForLongLivedToken(code, clientId, clientSecret, redirectUri);

  const { Tenant } = models();
  const row = await Tenant.findByPk(tenantId);
  if (!row) throw new Error("Tenant not found");
  row.instagramUserAccessToken = longToken;
  row.syndicationInstagramConnected = true;
  row.instagramBusinessAccountId = null;
  row.instagramUsername = null;
  row.instagramPageId = null;
  row.instagramPageAccessToken = null;
  await row.save();
  return tenantId;
}

/**
 * @param {string} tenantId
 */
export async function mockAuthorizeInstagramSyndication(tenantId) {
  if (process.env.INSTAGRAM_ALLOW_MOCK_AUTH !== "true") {
    throw new Error("Mock authorize disabled; use Instagram OAuth or set INSTAGRAM_ALLOW_MOCK_AUTH=true for local dev");
  }
  const { Tenant } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.syndicationInstagramConnected = true;
  row.instagramUserAccessToken = "mock-instagram-user-token";
  row.instagramBusinessAccountId = "mock-ig-business-id";
  row.instagramUsername = "mock_instagram";
  row.instagramPageId = "mock-page-id";
  row.instagramPageAccessToken = "mock-page-token";
  await row.save();
  return getSyndicationStatusForTenant(id);
}

/**
 * @param {string} tenantId
 * @returns {Promise<string | null>}
 */
export async function getTenantInstagramUserAccessToken(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  const t = row.get("instagramUserAccessToken");
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * @param {string} tenantId
 * @returns {Promise<Array<{ id: string; username: string; pageName: string }>>}
 */
export async function listInstagramAccountsForTenant(tenantId) {
  const userToken = await getTenantInstagramUserAccessToken(tenantId);
  if (!userToken) throw new Error("Tenant has no Instagram user access token");

  if (userToken === "mock-instagram-user-token") {
    return [{ id: "mock-ig-business-id", username: "mock_instagram", pageName: "Mock Page" }];
  }

  const json = await metaGraphGet(
    `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`,
  );
  const data = Array.isArray(json.data) ? json.data : [];
  const out = [];
  for (const p of data) {
    if (!p || typeof p !== "object") continue;
    const pageName = String(/** @type {{ name?: string }} */ (p).name || "").trim();
    const ig = /** @type {{ instagram_business_account?: { id?: string; username?: string } }} */ (p)
      .instagram_business_account;
    if (!ig || typeof ig !== "object") continue;
    const id = String(ig.id || "").trim();
    const username = String(ig.username || id).trim();
    if (!id) continue;
    out.push({
      id,
      username: username.startsWith("@") ? username : `@${username}`,
      pageName: pageName || id,
    });
  }
  return out;
}

/**
 * @param {string} tenantId
 * @param {string} businessAccountId
 */
export async function selectInstagramAccountForTenant(tenantId, businessAccountId) {
  const id = String(tenantId || "").trim();
  const igId = String(businessAccountId || "").trim();
  if (!id || !igId) throw new Error("tenantId and businessAccountId are required");

  const userToken = await getTenantInstagramUserAccessToken(id);
  if (!userToken) throw new Error("Tenant has no Instagram user access token");

  let username = igId;
  let pageId = "";
  let pageName = "";
  let pageAccessToken = userToken;

  if (userToken === "mock-instagram-user-token") {
    if (igId !== "mock-ig-business-id") throw new Error("Invalid mock Instagram account id");
    username = "mock_instagram";
    pageName = "Mock Page";
    pageId = "mock-page-id";
    pageAccessToken = "mock-page-token";
  } else {
    const json = await metaGraphGet(
      `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`,
    );
    const data = Array.isArray(json.data) ? json.data : [];
    let match = null;
    for (const p of data) {
      if (!p || typeof p !== "object") continue;
      const ig = /** @type {{ instagram_business_account?: { id?: string; username?: string } }} */ (p)
        .instagram_business_account;
      if (!ig || typeof ig !== "object") continue;
      if (String(ig.id || "").trim() !== igId) continue;
      match = p;
      break;
    }
    if (!match || typeof match !== "object") {
      throw new Error("Instagram Business account not found for this Meta login");
    }
    pageId = String(/** @type {{ id?: string }} */ (match).id || "").trim();
    pageName = String(/** @type {{ name?: string }} */ (match).name || pageId).trim();
    const pat = /** @type {{ access_token?: string }} */ (match).access_token;
    if (!pat || typeof pat !== "string" || !pat.trim()) {
      throw new Error("Meta did not return a page access token for this Instagram account");
    }
    pageAccessToken = pat.trim();
    const ig = /** @type {{ instagram_business_account?: { username?: string } }} */ (match).instagram_business_account;
    const un = ig && typeof ig === "object" ? String(ig.username || "").trim() : "";
    username = un ? (un.startsWith("@") ? un : `@${un}`) : igId;
  }

  const { Tenant } = models();
  const row = await Tenant.findByPk(id);
  if (!row) throw new Error("Tenant not found");
  row.instagramBusinessAccountId = igId;
  row.instagramUsername = username;
  row.instagramPageId = pageId;
  row.instagramPageAccessToken = pageAccessToken;
  await row.save();
  return getSyndicationStatusForTenant(id);
}

/**
 * @param {string} tenantId
 */
async function getTenantInstagramCredentials(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) throw new Error("Tenant not found");
  const igUserId = row.get("instagramBusinessAccountId");
  const pageToken = row.get("instagramPageAccessToken");
  const igId = typeof igUserId === "string" && igUserId.trim() ? igUserId.trim() : "";
  const pt = typeof pageToken === "string" && pageToken.trim() ? pageToken.trim() : "";
  if (!igId || !pt) throw new Error("Tenant has no Instagram Business account selected");
  return { igUserId: igId, pageAccessToken: pt };
}

/**
 * @param {string} creationId
 * @param {string} pageAccessToken
 */
async function waitForInstagramContainerReady(creationId, pageAccessToken) {
  const deadline = Date.now() + 5 * 60 * 1000;
  let waitMs = 3000;
  while (Date.now() < deadline) {
    const st = await metaGraphGet(
      `/${encodeURIComponent(creationId)}?fields=status_code&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    const code = String(st.status_code || "").toUpperCase();
    if (code === "FINISHED") return;
    if (code === "ERROR") {
      throw new Error(`Instagram media container failed: ${JSON.stringify(st).slice(0, 400)}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 15000)));
    waitMs = Math.min(waitMs + 1000, 15000);
  }
  throw new Error("Instagram media container did not finish processing in time");
}

/**
 * Upload encoded MP4 to Instagram (Reels or feed video).
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.videoUrl HTTP(S) URL to MP4 (must be reachable by Meta)
 * @param {string} opts.caption
 * @param {"reels"|"feed"} opts.mediaType
 */
export async function uploadVideoToInstagram(opts) {
  const { tenantId, videoUrl, caption, mediaType = "reels" } = opts;
  const { igUserId, pageAccessToken } = await getTenantInstagramCredentials(tenantId);
  const mt = mediaType === "feed" ? "feed" : "reels";

  if (pageAccessToken === "mock-page-token") {
    return {
      mediaId: "mock-ig-media-id",
      permalinkUrl: "https://www.instagram.com/p/mock-ig-media-id/",
    };
  }

  const body = new URLSearchParams({
    video_url: String(videoUrl).trim(),
    caption: String(caption || "").slice(0, 2200),
    access_token: pageAccessToken,
  });
  if (mt === "reels") {
    body.set("media_type", "REELS");
    body.set("share_to_feed", "true");
  } else {
    body.set("media_type", "VIDEO");
  }

  const createJson = await metaGraphPostForm(`/${encodeURIComponent(igUserId)}/media`, body);
  const creationId = createJson.id;
  if (!creationId) throw new Error("Instagram API returned no media container id");

  await waitForInstagramContainerReady(String(creationId), pageAccessToken);

  const publishBody = new URLSearchParams({
    creation_id: String(creationId),
    access_token: pageAccessToken,
  });
  const publishJson = await metaGraphPostForm(`/${encodeURIComponent(igUserId)}/media_publish`, publishBody);
  const mediaId = publishJson.id;
  if (!mediaId) throw new Error("Instagram API returned no published media id");

  let permalinkUrl = `https://www.instagram.com/`;
  try {
    const perm = await metaGraphGet(
      `/${encodeURIComponent(String(mediaId))}?fields=permalink&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    if (perm.permalink && typeof perm.permalink === "string") {
      permalinkUrl = perm.permalink.trim();
    }
  } catch {
    /* permalink optional */
  }

  return { mediaId: String(mediaId), permalinkUrl };
}

// --- TikTok Direct Post (Content Posting API) ---

const TIKTOK_AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_API = "https://open.tiktokapis.com";
const TIKTOK_SCOPES = ["user.info.basic", "video.publish"].join(",");

function tiktokOauthStateSecret() {
  return (
    String(
      config.tiktok.oauthStateSecret ||
        config.instagram.oauthStateSecret ||
        config.twitter.oauthStateSecret ||
        config.admin.jwtSecret ||
        "dev-insecure",
    ).trim() || "dev-insecure"
  );
}

/**
 * @param {string} tenantId
 */
export function signTiktokOAuthState(tenantId) {
  const id = String(tenantId || "").trim();
  const exp = Date.now() + 15 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ p: "tt", tid: id, exp }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", tiktokOauthStateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * @param {string} state
 * @returns {string|null} tenantId
 */
export function verifyTiktokOAuthState(state) {
  const raw = String(state || "").trim();
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = crypto.createHmac("sha256", tiktokOauthStateSecret()).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || data.p !== "tt" || typeof data.tid !== "string" || typeof data.exp !== "number") return null;
    if (Date.now() > data.exp) return null;
    return data.tid.trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, string>} bodyParams
 * @param {string} clientKey
 * @param {string} clientSecret
 */
async function tiktokTokenRequest(bodyParams, clientKey, clientSecret) {
  const body = new URLSearchParams(bodyParams);
  const res = await fetch(TIKTOK_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const msg = json?.error_description || json?.error || json?.message || res.statusText;
    throw new Error(`TikTok token endpoint failed: ${res.status} ${String(msg).slice(0, 500)}`);
  }
  return json;
}

/**
 * @param {string} accessToken
 * @param {string} path
 * @param {Record<string, unknown>} [body]
 */
async function tiktokApiPost(accessToken, path, body = {}) {
  const res = await fetch(`${TIKTOK_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  const errCode = json?.error?.code;
  if (!res.ok || (errCode && errCode !== "ok")) {
    const msg = json?.error?.message || JSON.stringify(json).slice(0, 500);
    throw new Error(`TikTok API failed: ${res.status} ${msg}`);
  }
  return /** @type {Record<string, unknown>} */ (json);
}

/**
 * @param {string} tenantId
 * @returns {Promise<string>} TikTok authorization URL
 */
export async function buildTiktokAuthorizationUrl(tenantId) {
  const id = String(tenantId || "").trim();
  const { clientKey, clientSecret, redirectUri } = await getResolvedTiktokOAuth();
  if (!clientKey || !clientSecret || !redirectUri) {
    throw new Error(
      "TikTok OAuth is not configured: set Client key, Client secret, and Redirect URI in Admin → Settings → Syndication → TikTok, or set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REDIRECT_URI on the backend.",
    );
  }
  const state = signTiktokOAuthState(id);
  const u = new URL(TIKTOK_AUTH);
  u.searchParams.set("client_key", clientKey);
  u.searchParams.set("scope", TIKTOK_SCOPES);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

/**
 * @param {string} accessToken
 */
async function fetchTiktokUsername(accessToken) {
  try {
    const res = await fetch(`${TIKTOK_API}/v2/user/info/?fields=open_id,username,display_name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json().catch(() => ({}));
    if (json?.error?.code === "ok" && json?.data?.user) {
      const user = json.data.user;
      if (typeof user.username === "string" && user.username.trim()) return user.username.trim();
      if (typeof user.display_name === "string" && user.display_name.trim()) return user.display_name.trim();
    }
  } catch {
    /* optional */
  }
  return null;
}

/**
 * @param {string} code
 * @param {string} state
 */
export async function completeTiktokOAuthCallback(code, state) {
  const tenantId = verifyTiktokOAuthState(state);
  if (!tenantId) throw new Error("Invalid or expired OAuth state");

  const { clientKey, clientSecret, redirectUri } = await getResolvedTiktokOAuth();
  if (!clientKey || !clientSecret || !redirectUri) {
    throw new Error("TikTok OAuth is not configured");
  }

  const json = await tiktokTokenRequest(
    {
      client_key: clientKey,
      client_secret: clientSecret,
      code: String(code || "").trim(),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    },
    clientKey,
    clientSecret,
  );

  const refresh = json.refresh_token;
  if (!refresh || typeof refresh !== "string") {
    throw new Error("TikTok did not return a refresh token; ensure video.publish scope is granted");
  }

  const access = json.access_token;
  const username =
    access && typeof access === "string" ? await fetchTiktokUsername(access.trim()) : null;

  const { Tenant } = models();
  const row = await Tenant.findByPk(tenantId);
  if (!row) throw new Error("Tenant not found");
  row.tiktokRefreshToken = refresh;
  row.tiktokOpenId = typeof json.open_id === "string" ? json.open_id : null;
  row.tiktokUsername = username;
  row.syndicationTiktokConnected = true;
  await row.save();
  return tenantId;
}

/**
 * Mock OAuth when TIKTOK_ALLOW_MOCK_AUTH=true.
 *
 * @param {string} tenantId
 */
export async function mockAuthorizeTiktokSyndication(tenantId) {
  if (process.env.TIKTOK_ALLOW_MOCK_AUTH !== "true") {
    throw new Error("Mock authorize disabled; use TikTok OAuth or set TIKTOK_ALLOW_MOCK_AUTH=true for local dev");
  }
  const { Tenant } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.tiktokRefreshToken = "mock-tiktok-refresh-token";
  row.tiktokOpenId = "mock-tiktok-open-id";
  row.tiktokUsername = "mock_tiktok";
  row.syndicationTiktokConnected = true;
  await row.save();
  return getSyndicationStatusForTenant(id);
}

/**
 * @param {string} tenantId
 * @returns {Promise<string | null>}
 */
export async function getTenantTiktokRefreshToken(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  const t = row.get("tiktokRefreshToken");
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * @param {string} tenantId
 * @returns {Promise<string>} user access token
 */
export async function getTiktokAccessTokenForTenant(tenantId) {
  const refresh = await getTenantTiktokRefreshToken(tenantId);
  if (!refresh) throw new Error("Tenant has no TikTok refresh token");
  if (refresh === "mock-tiktok-refresh-token") return "mock-tiktok-access-token";

  const { clientKey, clientSecret } = await getResolvedTiktokOAuth();
  if (!clientKey || !clientSecret) throw new Error("TikTok OAuth is not configured");

  const json = await tiktokTokenRequest(
    {
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refresh,
    },
    clientKey,
    clientSecret,
  );

  const access = json.access_token;
  if (!access || typeof access !== "string") {
    throw new Error("TikTok token refresh did not return access_token");
  }

  if (json.refresh_token && typeof json.refresh_token === "string") {
    const { Tenant } = models();
    const row = await Tenant.findByPk(String(tenantId || "").trim());
    if (row) {
      row.tiktokRefreshToken = json.refresh_token;
      await row.save();
    }
  }

  return access.trim();
}

/**
 * @param {string} tenantId
 */
export async function queryTiktokCreatorInfoForTenant(tenantId) {
  const access = await getTiktokAccessTokenForTenant(tenantId);
  if (access === "mock-tiktok-access-token") {
    return {
      creator_username: "mock_tiktok",
      creator_nickname: "Mock TikTok",
      privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
      comment_disabled: false,
      duet_disabled: false,
      stitch_disabled: false,
      max_video_post_duration_sec: 600,
    };
  }
  const json = await tiktokApiPost(access, "/v2/post/publish/creator_info/query/", {});
  const data = json.data && typeof json.data === "object" ? json.data : {};
  return data;
}

/**
 * @param {string} publishId
 * @param {string} accessToken
 */
async function waitForTiktokPublishComplete(publishId, accessToken) {
  const maxAttempts = 60;
  let waitMs = 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const json = await tiktokApiPost(accessToken, "/v2/post/publish/status/fetch/", {
      publish_id: publishId,
    });
    const data = json.data && typeof json.data === "object" ? json.data : {};
    const status = String(data.status || "").trim();
    if (status === "PUBLISH_COMPLETE") {
      const postIds = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id : [];
      const postId = postIds.length > 0 ? String(postIds[0]) : null;
      return { status, postId, failReason: null };
    }
    if (status === "FAILED") {
      return { status, postId: null, failReason: String(data.fail_reason || "unknown") };
    }
    await new Promise((r) => setTimeout(r, waitMs));
    waitMs = Math.min(waitMs + 500, 10000);
  }
  throw new Error("TikTok publish did not complete in time");
}

/**
 * Direct Post encoded MP4 to TikTok via PULL_FROM_URL.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.videoUrl HTTP(S) URL to MP4 (must be verified domain prefix in TikTok portal)
 * @param {string} opts.caption
 * @param {string} opts.privacyLevel
 * @param {boolean} [opts.disableDuet]
 * @param {boolean} [opts.disableComment]
 * @param {boolean} [opts.disableStitch]
 * @param {boolean} [opts.brandContentToggle]
 * @param {boolean} [opts.brandOrganicToggle]
 */
export async function uploadVideoToTiktok(opts) {
  const {
    tenantId,
    videoUrl,
    caption,
    privacyLevel,
    disableDuet = false,
    disableComment = false,
    disableStitch = false,
    brandContentToggle = false,
    brandOrganicToggle = false,
  } = opts;

  const access = await getTiktokAccessTokenForTenant(tenantId);
  if (access === "mock-tiktok-access-token") {
    return {
      publishId: "mock-tiktok-publish-id",
      postId: "mock-tiktok-post-id",
      shareUrl: "https://www.tiktok.com/@mock_tiktok/video/mock-tiktok-post-id",
    };
  }

  const creator = await queryTiktokCreatorInfoForTenant(tenantId);
  const options = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options : [];
  let privacy = String(privacyLevel || "").trim();
  if (!privacy || !options.includes(privacy)) {
    privacy = options.includes("SELF_ONLY") ? "SELF_ONLY" : String(options[0] || "SELF_ONLY");
  }

  const initJson = await tiktokApiPost(access, "/v2/post/publish/video/init/", {
    post_info: {
      title: String(caption || "").slice(0, 2200),
      privacy_level: privacy,
      disable_duet: Boolean(disableDuet) || creator.duet_disabled === true,
      disable_comment: Boolean(disableComment) || creator.comment_disabled === true,
      disable_stitch: Boolean(disableStitch) || creator.stitch_disabled === true,
      brand_content_toggle: Boolean(brandContentToggle),
      brand_organic_toggle: Boolean(brandOrganicToggle),
    },
    source_info: {
      source: "PULL_FROM_URL",
      video_url: String(videoUrl).trim(),
    },
  });

  const data = initJson.data && typeof initJson.data === "object" ? initJson.data : {};
  const publishId = data.publish_id;
  if (!publishId) throw new Error("TikTok API returned no publish_id");

  const result = await waitForTiktokPublishComplete(String(publishId), access);
  if (result.status === "FAILED") {
    throw new Error(`TikTok publish failed: ${result.failReason || "unknown"}`);
  }

  const username =
    typeof creator.creator_username === "string" && creator.creator_username.trim()
      ? creator.creator_username.trim()
      : null;
  let shareUrl = username && result.postId ? `https://www.tiktok.com/@${username}/video/${result.postId}` : null;

  return {
    publishId: String(publishId),
    postId: result.postId,
    shareUrl,
  };
}
