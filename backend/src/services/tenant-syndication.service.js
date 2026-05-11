import crypto from "crypto";
import { Readable } from "node:stream";
import { google } from "googleapis";
import { getSequelize } from "../db/sequelize.js";
import { config } from "../config.js";
import { getResolvedYoutubeOAuth } from "./admin-settings.service.js";

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
 * @returns {Promise<{ youtube: { connected: boolean } } | null>}
 */
export async function getSyndicationStatusForTenant(tenantId) {
  const { Tenant } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  const plain = row.get({ plain: true });
  const hasToken = Boolean(plain.youtubeRefreshToken && String(plain.youtubeRefreshToken).trim());
  return {
    youtube: {
      connected: hasToken || plain.syndicationYoutubeConnected === true,
      mockAuthAvailable: process.env.YOUTUBE_ALLOW_MOCK_AUTH === "true",
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
