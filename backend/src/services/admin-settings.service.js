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
  },
};

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
 */
function youtubeClientSecretStoredInDb(merged) {
  const synd = merged.syndication && typeof merged.syndication === "object" && !Array.isArray(merged.syndication) ? merged.syndication : {};
  const yt = /** @type {Record<string, unknown>} */ (synd).youtube;
  if (!yt || typeof yt !== "object" || Array.isArray(yt)) return false;
  const s = yt.oauthClientSecret;
  return typeof s === "string" && Boolean(s.trim());
}

export async function adminGetAppSettings() {
  const merged = await loadMergedSettingsFromDb();
  const resolved = resolveYoutubeOAuthFromMerged(merged);
  const secretInDb = youtubeClientSecretStoredInDb(merged);
  return {
    settings: sanitizeSettingsForAdminApi(merged),
    youtubeOAuthConfigured: Boolean(resolved.clientId && resolved.clientSecret && resolved.redirectUri),
    youtubeRedirectUri: resolved.redirectUri || null,
    youtubeDbClientSecretSet: secretInDb,
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
  }
  await row.update({ settings: next });
  return adminGetAppSettings();
}
