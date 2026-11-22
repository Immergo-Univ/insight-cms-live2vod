/**
 * Read/write the per-account publish defaults edited in Integrations → Social Media.
 */

import { getAccountById } from "./tenant-syndication-accounts.service.js";
import { getTiktokSyndicationDefaults } from "./admin-settings.service.js";
import { normalizeYoutubeAccountSettings } from "./youtube-account-settings.service.js";
import {
  normalizeFacebookAccountSettings,
  normalizeInstagramAccountSettings,
  normalizeTiktokAccountSettings,
  normalizeTwitterAccountSettings,
} from "./social-account-settings.service.js";

const SUPPORTED_PLATFORMS = new Set(["youtube", "facebook", "instagram", "twitter", "tiktok"]);

/**
 * @param {string} message
 * @param {number} statusCode
 */
function httpError(message, statusCode) {
  const error = /** @type {Error & { statusCode?: number }} */ (new Error(message));
  error.statusCode = statusCode;
  return error;
}

/**
 * @param {string} platform
 * @param {unknown} raw
 */
async function normalizeForPlatform(platform, raw) {
  if (platform === "youtube") return normalizeYoutubeAccountSettings(raw);
  if (platform === "facebook") return normalizeFacebookAccountSettings(raw);
  if (platform === "instagram") return normalizeInstagramAccountSettings(raw);
  if (platform === "twitter") return normalizeTwitterAccountSettings(raw);
  return normalizeTiktokAccountSettings(raw, await getTiktokSyndicationDefaults());
}

/**
 * @param {string} tenantId
 * @param {string} platform
 * @param {string} accountId
 */
async function loadAccount(tenantId, platform, accountId) {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw httpError("Unsupported platform", 400);
  const row = await getAccountById(accountId);
  if (!row || String(row.get("tenantId")) !== String(tenantId || "").trim()) {
    throw httpError("Syndication account not found", 404);
  }
  if (row.get("platform") !== platform) throw httpError(`Account is not a ${platform} account`, 400);
  return row;
}

/**
 * @param {string} tenantId
 * @param {string} platform
 * @param {string} accountId
 */
export async function getSyndicationAccountSettings(tenantId, platform, accountId) {
  const row = await loadAccount(tenantId, platform, accountId);
  return normalizeForPlatform(platform, row.get("settings"));
}

/**
 * @param {string} tenantId
 * @param {string} platform
 * @param {string} accountId
 * @param {unknown} body
 */
export async function saveSyndicationAccountSettings(tenantId, platform, accountId, body) {
  const row = await loadAccount(tenantId, platform, accountId);
  const settings = await normalizeForPlatform(platform, body);
  row.set("settings", settings);
  await row.save();
  return settings;
}
