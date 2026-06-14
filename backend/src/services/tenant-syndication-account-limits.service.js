import { getSequelize } from "../db/sequelize.js";
import { listAccountsForTenant } from "./tenant-syndication-accounts.service.js";

/** @typedef {'youtube'|'twitter'|'facebook'|'instagram'|'tiktok'} SyndicationPlatform */

export const DEFAULT_SYNDICATION_ACCOUNT_MAX = 5;
export const MAX_SYNDICATION_ACCOUNT_LIMIT = 50;

/** @type {SyndicationPlatform[]} */
export const SYNDICATION_PLATFORMS = ["youtube", "twitter", "facebook", "instagram", "tiktok"];

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
}

/**
 * @param {unknown} raw
 * @returns {Record<SyndicationPlatform, number>}
 */
export function normalizeSyndicationAccountMaxByPlatform(raw) {
  /** @type {Record<string, unknown>} */
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  /** @type {Record<SyndicationPlatform, number>} */
  const out = /** @type {Record<SyndicationPlatform, number>} */ ({});
  for (const platform of SYNDICATION_PLATFORMS) {
    const v = Number(src[platform]);
    out[platform] =
      Number.isFinite(v) && v >= 1 && v <= MAX_SYNDICATION_ACCOUNT_LIMIT
        ? Math.floor(v)
        : DEFAULT_SYNDICATION_ACCOUNT_MAX;
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {Record<SyndicationPlatform, number> | null}
 */
export function parseSyndicationAccountMaxByPlatformInput(raw) {
  if (raw === undefined) return null;
  if (raw === null) {
    /** @type {Record<SyndicationPlatform, number>} */
    const cleared = /** @type {Record<SyndicationPlatform, number>} */ ({});
    for (const platform of SYNDICATION_PLATFORMS) {
      cleared[platform] = DEFAULT_SYNDICATION_ACCOUNT_MAX;
    }
    return cleared;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("syndicationAccountMaxByPlatform must be an object");
  }
  /** @type {Record<SyndicationPlatform, number>} */
  const out = /** @type {Record<SyndicationPlatform, number>} */ ({});
  for (const platform of SYNDICATION_PLATFORMS) {
    if (!(platform in raw)) {
      out[platform] = DEFAULT_SYNDICATION_ACCOUNT_MAX;
      continue;
    }
    const v = Number(/** @type {Record<string, unknown>} */ (raw)[platform]);
    if (!Number.isFinite(v) || v < 1 || v > MAX_SYNDICATION_ACCOUNT_LIMIT) {
      throw new Error(`Invalid max account limit for ${platform} (must be 1-${MAX_SYNDICATION_ACCOUNT_LIMIT})`);
    }
    out[platform] = Math.floor(v);
  }
  return out;
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 */
export async function getSyndicationAccountLimitForPlatform(tenantId, platform) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  const limits = normalizeSyndicationAccountMaxByPlatform(row?.get("syndicationAccountMaxByPlatform"));
  return limits[platform];
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 */
export async function countSyndicationAccountsForPlatform(tenantId, platform) {
  const accounts = await listAccountsForTenant(String(tenantId || "").trim(), platform);
  return accounts.filter((a) => a.status === "active" || a.status === "pending_selection").length;
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 */
export async function canAddSyndicationAccount(tenantId, platform) {
  const max = await getSyndicationAccountLimitForPlatform(tenantId, platform);
  const count = await countSyndicationAccountsForPlatform(tenantId, platform);
  return count < max;
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 */
export async function assertCanAddSyndicationAccount(tenantId, platform) {
  const max = await getSyndicationAccountLimitForPlatform(tenantId, platform);
  const count = await countSyndicationAccountsForPlatform(tenantId, platform);
  if (count >= max) {
    const err = new Error(
      `Syndication account limit reached (${max}) for ${platform}. Contact your administrator to increase the limit.`,
    );
    err.code = "ACCOUNT_LIMIT_REACHED";
    throw err;
  }
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 */
export async function getSyndicationAccountLimitSummary(tenantId, platform) {
  const maxAccounts = await getSyndicationAccountLimitForPlatform(tenantId, platform);
  const accountCount = await countSyndicationAccountsForPlatform(tenantId, platform);
  return {
    maxAccounts,
    accountCount,
    canAddAccount: accountCount < maxAccounts,
  };
}
