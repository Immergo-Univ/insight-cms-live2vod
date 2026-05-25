import { getSequelize } from "../db/sequelize.js";
import { config } from "../config.js";

const DEFAULT_SETTINGS = {
  syndication: {
    youtube: {
      /** Immergo defaults applied when creating new clip syndication rows (editor can override per clip). */
      defaultPrivacy: "private",
      defaultCategoryId: "22",
      defaultEmbeddable: true,
      defaultMadeForKids: false,
      defaultLicense: "youtube",
      defaultNotifySubscribers: false,
      defaultPublicStatsViewable: true,
    },
    twitter: {
      /** Default tweet text when clip has no override (editor can override per clip). */
      defaultTweetText: "",
    },
    facebook: {
      /** Default video description when clip has no override (editor can override per clip). */
      defaultDescription: "",
    },
    instagram: {
      /** Default caption when clip has no override (editor can override per clip). */
      defaultCaption: "",
    },
    tiktok: {
      defaultCaption: "",
      defaultPrivacyLevel: "SELF_ONLY",
      domainVerificationPath: "",
      domainVerificationFileContent: "",
      domainVerificationContentType: "text/plain; charset=utf-8",
    },
  },
};

/**
 * @param {string} rawPath
 */
function normalizePublicFilePath(rawPath) {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  const noQuery = trimmed.split("?")[0].split("#")[0].trim();
  if (!noQuery) return "";
  const withLeadingSlash = noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  return withLeadingSlash.replace(/\/{2,}/g, "/");
}

/**
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} extra
 */
function deepMergeSettings(base, extra) {
  const out = { ...base };
  for (const k of Object.keys(extra)) {
    const bv = out[k];
    const ev = extra[k];
    if (ev && typeof ev === "object" && !Array.isArray(ev) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      out[k] = deepMergeSettings(/** @type {Record<string, unknown>} */ (bv), /** @type {Record<string, unknown>} */ (ev));
    } else {
      out[k] = ev;
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} settings
 */
function sanitizeSettingsForAdminApi(settings) {
  const raw = JSON.stringify(settings);
  const out = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
  const syn = out.syndication;
  if (syn && typeof syn === "object" && !Array.isArray(syn)) {
    const yt = /** @type {Record<string, unknown>} */ (syn).youtube;
    if (yt && typeof yt === "object" && !Array.isArray(yt)) {
      delete yt.oauthClientSecret;
      delete yt.oauthHelp;
    }
    const tw = /** @type {Record<string, unknown>} */ (syn).twitter;
    if (tw && typeof tw === "object" && !Array.isArray(tw)) {
      delete tw.oauthClientSecret;
      delete tw.oauthHelp;
    }
    const fb = /** @type {Record<string, unknown>} */ (syn).facebook;
    if (fb && typeof fb === "object" && !Array.isArray(fb)) {
      delete fb.oauthClientSecret;
      delete fb.oauthHelp;
    }
    const ig = /** @type {Record<string, unknown>} */ (syn).instagram;
    if (ig && typeof ig === "object" && !Array.isArray(ig)) {
      delete ig.oauthClientSecret;
      delete ig.oauthHelp;
    }
    const tt = /** @type {Record<string, unknown>} */ (syn).tiktok;
    if (tt && typeof tt === "object" && !Array.isArray(tt)) {
      delete tt.oauthClientSecret;
      delete tt.oauthHelp;
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} incoming
 */
function stripEmptyYoutubeClientSecret(incoming) {
  const syn = incoming.syndication;
  if (!syn || typeof syn !== "object" || Array.isArray(syn)) return;
  const yt = /** @type {Record<string, unknown>} */ (syn).youtube;
  if (!yt || typeof yt !== "object" || Array.isArray(yt)) return;
  if (typeof yt.oauthClientSecret === "string" && !yt.oauthClientSecret.trim()) {
    delete yt.oauthClientSecret;
  }
}

/**
 * @param {Record<string, unknown>} incoming
 */
function stripEmptyTwitterClientSecret(incoming) {
  const syn = incoming.syndication;
  if (!syn || typeof syn !== "object" || Array.isArray(syn)) return;
  const tw = /** @type {Record<string, unknown>} */ (syn).twitter;
  if (!tw || typeof tw !== "object" || Array.isArray(tw)) return;
  if (typeof tw.oauthClientSecret === "string" && !tw.oauthClientSecret.trim()) {
    delete tw.oauthClientSecret;
  }
}

/**
 * @param {Record<string, unknown>} incoming
 */
function stripEmptyFacebookClientSecret(incoming) {
  const syn = incoming.syndication;
  if (!syn || typeof syn !== "object" || Array.isArray(syn)) return;
  const fb = /** @type {Record<string, unknown>} */ (syn).facebook;
  if (!fb || typeof fb !== "object" || Array.isArray(fb)) return;
  if (typeof fb.oauthClientSecret === "string" && !fb.oauthClientSecret.trim()) {
    delete fb.oauthClientSecret;
  }
}

/**
 * @param {Record<string, unknown>} incoming
 */
function stripEmptyInstagramClientSecret(incoming) {
  const syn = incoming.syndication;
  if (!syn || typeof syn !== "object" || Array.isArray(syn)) return;
  const ig = /** @type {Record<string, unknown>} */ (syn).instagram;
  if (!ig || typeof ig !== "object" || Array.isArray(ig)) return;
  if (typeof ig.oauthClientSecret === "string" && !ig.oauthClientSecret.trim()) {
    delete ig.oauthClientSecret;
  }
}

/**
 * @param {Record<string, unknown>} incoming
 */
function stripEmptyTiktokClientSecret(incoming) {
  const syn = incoming.syndication;
  if (!syn || typeof syn !== "object" || Array.isArray(syn)) return;
  const tt = /** @type {Record<string, unknown>} */ (syn).tiktok;
  if (!tt || typeof tt !== "object" || Array.isArray(tt)) return;
  if (typeof tt.oauthClientSecret === "string" && !tt.oauthClientSecret.trim()) {
    delete tt.oauthClientSecret;
  }
}

/**
 * @param {Record<string, unknown>} incoming
 */
function sanitizeTiktokDomainVerification(incoming) {
  const syn = incoming.syndication;
  if (!syn || typeof syn !== "object" || Array.isArray(syn)) return;
  const tt = /** @type {Record<string, unknown>} */ (syn).tiktok;
  if (!tt || typeof tt !== "object" || Array.isArray(tt)) return;
  if ("domainVerificationPath" in tt) {
    tt.domainVerificationPath = normalizePublicFilePath(String(tt.domainVerificationPath ?? ""));
  }
  if ("domainVerificationFileContent" in tt) {
    tt.domainVerificationFileContent = String(tt.domainVerificationFileContent ?? "");
  }
  if ("domainVerificationContentType" in tt) {
    const nextType = String(tt.domainVerificationContentType ?? "").trim();
    tt.domainVerificationContentType = nextType || "text/plain; charset=utf-8";
  }
}

async function loadMergedSettingsFromDb() {
  const sequelize = getSequelize();
  if (!sequelize) throw new Error("Database not available");
  const { AppSetting } = sequelize.models;
  const [row] = await AppSetting.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1, settings: {} },
  });
  const stored = row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {};
  return deepMergeSettings(DEFAULT_SETTINGS, /** @type {Record<string, unknown>} */ (stored));
}

/**
 * @param {Record<string, unknown>} merged
 * @returns {{ clientId: string; clientSecret: string; redirectUri: string }}
 */
function resolveYoutubeOAuthFromMerged(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const ytRaw = /** @type {Record<string, unknown>} */ (synd).youtube;
  const yt = ytRaw && typeof ytRaw === "object" && !Array.isArray(ytRaw) ? ytRaw : {};
  const fromDb = (key) => String(yt[key] ?? "").trim();
  const clientId = fromDb("oauthClientId") || config.youtube.clientId;
  const clientSecret = fromDb("oauthClientSecret") || config.youtube.clientSecret;
  const redirectUri = fromDb("oauthRedirectUri") || config.youtube.redirectUri;
  return { clientId, clientSecret, redirectUri };
}

/**
 * OAuth app credentials: non-empty values in `app_settings` override environment variables.
 *
 * @returns {Promise<{ clientId: string; clientSecret: string; redirectUri: string }>}
 */
export async function getResolvedYoutubeOAuth() {
  const sequelize = getSequelize();
  if (!sequelize) return resolveYoutubeOAuthFromMerged(DEFAULT_SETTINGS);
  try {
    const merged = await loadMergedSettingsFromDb();
    return resolveYoutubeOAuthFromMerged(merged);
  } catch {
    return resolveYoutubeOAuthFromMerged(DEFAULT_SETTINGS);
  }
}

/**
 * @param {Record<string, unknown>} merged
 * @returns {{ clientId: string; clientSecret: string; redirectUri: string }}
 */
function resolveTwitterOAuthFromMerged(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const twRaw = /** @type {Record<string, unknown>} */ (synd).twitter;
  const tw = twRaw && typeof twRaw === "object" && !Array.isArray(twRaw) ? twRaw : {};
  const fromDb = (key) => String(tw[key] ?? "").trim();
  const clientId = fromDb("oauthClientId") || config.twitter.clientId;
  const clientSecret = fromDb("oauthClientSecret") || config.twitter.clientSecret;
  const redirectUri = fromDb("oauthRedirectUri") || config.twitter.redirectUri;
  return { clientId, clientSecret, redirectUri };
}

/**
 * @returns {Promise<{ clientId: string; clientSecret: string; redirectUri: string }>}
 */
export async function getResolvedTwitterOAuth() {
  const sequelize = getSequelize();
  if (!sequelize) return resolveTwitterOAuthFromMerged(DEFAULT_SETTINGS);
  try {
    const merged = await loadMergedSettingsFromDb();
    return resolveTwitterOAuthFromMerged(merged);
  } catch {
    return resolveTwitterOAuthFromMerged(DEFAULT_SETTINGS);
  }
}

/**
 * @param {Record<string, unknown>} merged
 * @returns {{ clientId: string; clientSecret: string; redirectUri: string }}
 */
function resolveFacebookOAuthFromMerged(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const fbRaw = /** @type {Record<string, unknown>} */ (synd).facebook;
  const fb = fbRaw && typeof fbRaw === "object" && !Array.isArray(fbRaw) ? fbRaw : {};
  const fromDb = (key) => String(fb[key] ?? "").trim();
  const clientId = fromDb("oauthClientId") || config.facebook.appId;
  const clientSecret = fromDb("oauthClientSecret") || config.facebook.appSecret;
  const redirectUri = fromDb("oauthRedirectUri") || config.facebook.redirectUri;
  return { clientId, clientSecret, redirectUri };
}

/**
 * @returns {Promise<{ clientId: string; clientSecret: string; redirectUri: string }>}
 */
export async function getResolvedFacebookOAuth() {
  const sequelize = getSequelize();
  if (!sequelize) return resolveFacebookOAuthFromMerged(DEFAULT_SETTINGS);
  try {
    const merged = await loadMergedSettingsFromDb();
    return resolveFacebookOAuthFromMerged(merged);
  } catch {
    return resolveFacebookOAuthFromMerged(DEFAULT_SETTINGS);
  }
}

/**
 * @param {Record<string, unknown>} merged
 * @returns {{ clientId: string; clientSecret: string; redirectUri: string }}
 */
function resolveInstagramOAuthFromMerged(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const igRaw = /** @type {Record<string, unknown>} */ (synd).instagram;
  const ig = igRaw && typeof igRaw === "object" && !Array.isArray(igRaw) ? igRaw : {};
  const fromDb = (key) => String(ig[key] ?? "").trim();
  const clientId = fromDb("oauthClientId") || config.instagram.appId;
  const clientSecret = fromDb("oauthClientSecret") || config.instagram.appSecret;
  const redirectUri = fromDb("oauthRedirectUri") || config.instagram.redirectUri;
  return { clientId, clientSecret, redirectUri };
}

/**
 * @returns {Promise<{ clientId: string; clientSecret: string; redirectUri: string }>}
 */
export async function getResolvedInstagramOAuth() {
  const sequelize = getSequelize();
  if (!sequelize) return resolveInstagramOAuthFromMerged(DEFAULT_SETTINGS);
  try {
    const merged = await loadMergedSettingsFromDb();
    return resolveInstagramOAuthFromMerged(merged);
  } catch {
    return resolveInstagramOAuthFromMerged(DEFAULT_SETTINGS);
  }
}

/**
 * @param {Record<string, unknown>} merged
 * @returns {{ clientKey: string; clientSecret: string; redirectUri: string }}
 */
function resolveTiktokOAuthFromMerged(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const ttRaw = /** @type {Record<string, unknown>} */ (synd).tiktok;
  const tt = ttRaw && typeof ttRaw === "object" && !Array.isArray(ttRaw) ? ttRaw : {};
  const fromDb = (key) => String(tt[key] ?? "").trim();
  const clientKey = fromDb("oauthClientKey") || config.tiktok.clientKey;
  const clientSecret = fromDb("oauthClientSecret") || config.tiktok.clientSecret;
  const redirectUri = fromDb("oauthRedirectUri") || config.tiktok.redirectUri;
  return { clientKey, clientSecret, redirectUri };
}

/**
 * @returns {Promise<{ clientKey: string; clientSecret: string; redirectUri: string }>}
 */
export async function getResolvedTiktokOAuth() {
  const sequelize = getSequelize();
  if (!sequelize) return resolveTiktokOAuthFromMerged(DEFAULT_SETTINGS);
  try {
    const merged = await loadMergedSettingsFromDb();
    return resolveTiktokOAuthFromMerged(merged);
  } catch {
    return resolveTiktokOAuthFromMerged(DEFAULT_SETTINGS);
  }
}

/**
 * @returns {Promise<{ defaultCaption: string; defaultPrivacyLevel: string }>}
 */
export async function getTiktokSyndicationDefaults() {
  try {
    const merged = await loadMergedSettingsFromDb();
    const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
    const ttRaw = /** @type {Record<string, unknown>} */ (synd).tiktok;
    const tt = ttRaw && typeof ttRaw === "object" && !Array.isArray(ttRaw) ? ttRaw : {};
    const defaultCaption = typeof tt.defaultCaption === "string" ? tt.defaultCaption.trim() : "";
    const defaultPrivacyLevel =
      typeof tt.defaultPrivacyLevel === "string" && tt.defaultPrivacyLevel.trim()
        ? tt.defaultPrivacyLevel.trim()
        : "SELF_ONLY";
    return { defaultCaption, defaultPrivacyLevel };
  } catch {
    return { defaultCaption: "", defaultPrivacyLevel: "SELF_ONLY" };
  }
}

/**
 * @returns {Promise<{ path: string; content: string; contentType: string }>}
 */
export async function getResolvedTiktokDomainVerificationFile() {
  const fromEnvPath = normalizePublicFilePath(config.tiktok.domainVerificationPath);
  const fromEnvContent = String(config.tiktok.domainVerificationFileContent || "");
  const fromEnvContentType = String(config.tiktok.domainVerificationContentType || "").trim() || "text/plain; charset=utf-8";
  const fallback = {
    path: fromEnvPath,
    content: fromEnvContent,
    contentType: fromEnvContentType,
  };
  const sequelize = getSequelize();
  if (!sequelize) return fallback;
  try {
    const merged = await loadMergedSettingsFromDb();
    const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
    const ttRaw = /** @type {Record<string, unknown>} */ (synd).tiktok;
    const tt = ttRaw && typeof ttRaw === "object" && !Array.isArray(ttRaw) ? ttRaw : {};
    const dbPath = normalizePublicFilePath(String(tt.domainVerificationPath ?? ""));
    const dbContent = String(tt.domainVerificationFileContent ?? "");
    const dbContentType = String(tt.domainVerificationContentType ?? "").trim();
    return {
      path: dbPath || fallback.path,
      content: dbContent || fallback.content,
      contentType: dbContentType || fallback.contentType,
    };
  } catch {
    return fallback;
  }
}

/**
 * @param {Record<string, unknown>} merged
 */
function youtubeClientSecretStoredInDb(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const yt = /** @type {Record<string, unknown>} */ (synd).youtube;
  if (!yt || typeof yt !== "object" || Array.isArray(yt)) return false;
  const s = yt.oauthClientSecret;
  return typeof s === "string" && Boolean(s.trim());
}

/**
 * @param {Record<string, unknown>} merged
 */
function twitterClientSecretStoredInDb(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const tw = /** @type {Record<string, unknown>} */ (synd).twitter;
  if (!tw || typeof tw !== "object" || Array.isArray(tw)) return false;
  const s = tw.oauthClientSecret;
  return typeof s === "string" && Boolean(s.trim());
}

/**
 * @param {Record<string, unknown>} merged
 */
function facebookClientSecretStoredInDb(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const fb = /** @type {Record<string, unknown>} */ (synd).facebook;
  if (!fb || typeof fb !== "object" || Array.isArray(fb)) return false;
  const s = fb.oauthClientSecret;
  return typeof s === "string" && Boolean(s.trim());
}

/**
 * @param {Record<string, unknown>} merged
 */
function instagramClientSecretStoredInDb(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const ig = /** @type {Record<string, unknown>} */ (synd).instagram;
  if (!ig || typeof ig !== "object" || Array.isArray(ig)) return false;
  const s = ig.oauthClientSecret;
  return typeof s === "string" && Boolean(s.trim());
}

/**
 * @param {Record<string, unknown>} merged
 */
function tiktokClientSecretStoredInDb(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const tt = /** @type {Record<string, unknown>} */ (synd).tiktok;
  if (!tt || typeof tt !== "object" || Array.isArray(tt)) return false;
  const s = tt.oauthClientSecret;
  return typeof s === "string" && Boolean(s.trim());
}

export async function adminGetAppSettings() {
  const merged = await loadMergedSettingsFromDb();
  const resolvedYt = resolveYoutubeOAuthFromMerged(merged);
  const resolvedTw = resolveTwitterOAuthFromMerged(merged);
  const resolvedFb = resolveFacebookOAuthFromMerged(merged);
  const resolvedIg = resolveInstagramOAuthFromMerged(merged);
  const resolvedTt = resolveTiktokOAuthFromMerged(merged);
  return {
    settings: sanitizeSettingsForAdminApi(merged),
    youtubeOAuthConfigured: Boolean(resolvedYt.clientId && resolvedYt.clientSecret && resolvedYt.redirectUri),
    youtubeRedirectUri: resolvedYt.redirectUri || null,
    youtubeDbClientSecretSet: youtubeClientSecretStoredInDb(merged),
    twitterOAuthConfigured: Boolean(resolvedTw.clientId && resolvedTw.clientSecret && resolvedTw.redirectUri),
    twitterRedirectUri: resolvedTw.redirectUri || null,
    twitterDbClientSecretSet: twitterClientSecretStoredInDb(merged),
    facebookOAuthConfigured: Boolean(resolvedFb.clientId && resolvedFb.clientSecret && resolvedFb.redirectUri),
    facebookRedirectUri: resolvedFb.redirectUri || null,
    facebookDbClientSecretSet: facebookClientSecretStoredInDb(merged),
    instagramOAuthConfigured: Boolean(resolvedIg.clientId && resolvedIg.clientSecret && resolvedIg.redirectUri),
    instagramRedirectUri: resolvedIg.redirectUri || null,
    instagramDbClientSecretSet: instagramClientSecretStoredInDb(merged),
    tiktokOAuthConfigured: Boolean(resolvedTt.clientKey && resolvedTt.clientSecret && resolvedTt.redirectUri),
    tiktokRedirectUri: resolvedTt.redirectUri || null,
    tiktokDbClientSecretSet: tiktokClientSecretStoredInDb(merged),
  };
}

/**
 * @param {object} body
 */
export async function adminPatchAppSettings(body) {
  const sequelize = getSequelize();
  if (!sequelize) throw new Error("Database not available");
  const { AppSetting } = sequelize.models;
  const [row] = await AppSetting.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1, settings: {} },
  });
  const prev = row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {};
  const incomingRoot =
    body && typeof body === "object" && body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
      ? body.settings
      : body && typeof body === "object"
        ? body
        : {};
  const incoming = /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(incomingRoot)));
  stripEmptyYoutubeClientSecret(incoming);
  stripEmptyTwitterClientSecret(incoming);
  stripEmptyFacebookClientSecret(incoming);
  stripEmptyInstagramClientSecret(incoming);
  stripEmptyTiktokClientSecret(incoming);
  sanitizeTiktokDomainVerification(incoming);
  const next = deepMergeSettings(
    deepMergeSettings(DEFAULT_SETTINGS, /** @type {Record<string, unknown>} */ (prev)),
    incoming,
  );
  const synNext = next.syndication;
  if (synNext && typeof synNext === "object" && !Array.isArray(synNext)) {
    const ytNext = /** @type {Record<string, unknown>} */ (synNext).youtube;
    if (ytNext && typeof ytNext === "object" && !Array.isArray(ytNext)) {
      delete ytNext.oauthHelp;
    }
    const twNext = /** @type {Record<string, unknown>} */ (synNext).twitter;
    if (twNext && typeof twNext === "object" && !Array.isArray(twNext)) {
      delete twNext.oauthHelp;
    }
    const fbNext = /** @type {Record<string, unknown>} */ (synNext).facebook;
    if (fbNext && typeof fbNext === "object" && !Array.isArray(fbNext)) {
      delete fbNext.oauthHelp;
    }
    const igNext = /** @type {Record<string, unknown>} */ (synNext).instagram;
    if (igNext && typeof igNext === "object" && !Array.isArray(igNext)) {
      delete igNext.oauthHelp;
    }
    const ttNext = /** @type {Record<string, unknown>} */ (synNext).tiktok;
    if (ttNext && typeof ttNext === "object" && !Array.isArray(ttNext)) {
      delete ttNext.oauthHelp;
    }
  }
  await row.update({ settings: next });
  return adminGetAppSettings();
}
