import crypto from "crypto";
import { getSequelize } from "../db/sequelize.js";
import { assertCanAddSyndicationAccount, getSyndicationAccountLimitSummary } from "./tenant-syndication-account-limits.service.js";

/** @typedef {'youtube'|'twitter'|'facebook'|'instagram'|'tiktok'} SyndicationPlatform */

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
}

/**
 * @returns {string}
 */
export function newSyndicationAccountId() {
  return crypto.randomUUID();
}

/**
 * @param {import("sequelize").Model} row
 */
function accountRowToSummary(row) {
  const plain = row.get({ plain: true });
  return {
    id: plain.id,
    platform: plain.platform,
    displayName: plain.displayName || plain.externalAccountId || plain.id,
    status: plain.status,
    externalAccountId: plain.externalAccountId,
  };
}

/**
 * Sync tenant-level *Connected flags from account rows.
 *
 * @param {string} tenantId
 */
export async function syncTenantSyndicationConnectedFlags(tenantId) {
  const id = String(tenantId || "").trim();
  if (!id) return;
  const { Tenant, TenantSyndicationAccount } = models();
  const row = await Tenant.findByPk(id);
  if (!row) return;

  const accounts = await TenantSyndicationAccount.findAll({ where: { tenantId: id } });
  const activeByPlatform = /** @type {Record<string, boolean>} */ ({});
  for (const a of accounts) {
    const p = a.get("platform");
    const st = a.get("status");
    if (st === "active") activeByPlatform[String(p)] = true;
    if (st === "pending_selection") activeByPlatform[String(p)] = true;
  }

  row.syndicationYoutubeConnected = !!activeByPlatform.youtube;
  row.syndicationTwitterConnected = !!activeByPlatform.twitter;
  row.syndicationFacebookConnected = !!activeByPlatform.facebook;
  row.syndicationInstagramConnected = !!activeByPlatform.instagram;
  row.syndicationTiktokConnected = !!activeByPlatform.tiktok;
  await row.save();
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} [platform]
 */
export async function listAccountsForTenant(tenantId, platform) {
  const { TenantSyndicationAccount } = models();
  const id = String(tenantId || "").trim();
  if (!id) return [];
  /** @type {Record<string, unknown>} */
  const where = { tenantId: id };
  if (platform) where.platform = platform;
  const rows = await TenantSyndicationAccount.findAll({
    where,
    order: [["createdAt", "ASC"]],
  });
  return rows.map(accountRowToSummary);
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 */
export async function getActiveAccountsForPublish(tenantId, platform) {
  const { TenantSyndicationAccount } = models();
  const id = String(tenantId || "").trim();
  if (!id) return [];
  const rows = await TenantSyndicationAccount.findAll({
    where: { tenantId: id, platform, status: "active" },
    order: [["createdAt", "ASC"]],
  });
  return rows;
}

/**
 * @param {string} accountId
 */
export async function getAccountById(accountId) {
  const { TenantSyndicationAccount } = models();
  const id = String(accountId || "").trim();
  if (!id) return null;
  return TenantSyndicationAccount.findByPk(id);
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 * @param {string} externalAccountId
 */
export async function findAccountByExternalId(tenantId, platform, externalAccountId) {
  const { TenantSyndicationAccount } = models();
  const tid = String(tenantId || "").trim();
  const ext = String(externalAccountId || "").trim();
  if (!tid || !ext) return null;
  return TenantSyndicationAccount.findOne({
    where: { tenantId: tid, platform, externalAccountId: ext },
  });
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {SyndicationPlatform} opts.platform
 * @param {string} opts.externalAccountId
 * @param {string} [opts.displayName]
 * @param {Record<string, unknown>} opts.credentials
 * @param {'active'|'pending_selection'} [opts.status]
 */
export async function createSyndicationAccount(opts) {
  const { Tenant, TenantSyndicationAccount } = models();
  const tenantId = String(opts.tenantId || "").trim();
  if (!tenantId) throw new Error("tenantId is required");
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new Error("Tenant not found");

  await assertCanAddSyndicationAccount(tenantId, opts.platform);

  const accountId = newSyndicationAccountId();
  const externalAccountId = String(opts.externalAccountId || "").trim() || `pending-${accountId}`;

  const row = await TenantSyndicationAccount.create({
    id: accountId,
    tenantId,
    platform: opts.platform,
    externalAccountId,
    displayName: opts.displayName || externalAccountId,
    credentials: opts.credentials || {},
    status: opts.status || "active",
  });

  await syncTenantSyndicationConnectedFlags(tenantId);
  return row;
}

/**
 * @param {string} accountId
 * @param {object} patch
 * @param {string} [patch.externalAccountId]
 * @param {string} [patch.displayName]
 * @param {Record<string, unknown>} [patch.credentials]
 * @param {'active'|'pending_selection'} [patch.status]
 */
export async function updateSyndicationAccount(accountId, patch) {
  const row = await getAccountById(accountId);
  if (!row) throw new Error("Syndication account not found");

  if (patch.externalAccountId != null) row.externalAccountId = String(patch.externalAccountId).trim();
  if (patch.displayName != null) row.displayName = String(patch.displayName).trim();
  if (patch.credentials != null) row.credentials = patch.credentials;
  if (patch.status != null) row.status = patch.status;
  await row.save();

  await syncTenantSyndicationConnectedFlags(row.get("tenantId"));
  return row;
}

/**
 * @param {string} accountId
 */
export async function deleteSyndicationAccount(accountId) {
  const row = await getAccountById(accountId);
  if (!row) return false;
  const tenantId = row.get("tenantId");
  await row.destroy();
  await syncTenantSyndicationConnectedFlags(tenantId);
  return true;
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 */
export async function deleteAllAccountsForPlatform(tenantId, platform) {
  const { TenantSyndicationAccount } = models();
  const id = String(tenantId || "").trim();
  if (!id) return 0;
  const n = await TenantSyndicationAccount.destroy({ where: { tenantId: id, platform } });
  await syncTenantSyndicationConnectedFlags(id);
  return n;
}

/**
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 */
export async function getPendingAccountForPlatform(tenantId, platform) {
  const { TenantSyndicationAccount } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  return TenantSyndicationAccount.findOne({
    where: { tenantId: id, platform, status: "pending_selection" },
    order: [["createdAt", "DESC"]],
  });
}

/**
 * @param {import("sequelize").Model} row
 */
export function getAccountCredentials(row) {
  const cred = row.get("credentials");
  return cred && typeof cred === "object" && !Array.isArray(cred) ? cred : {};
}

/**
 * Build public platform status from account rows.
 *
 * @param {string} tenantId
 * @param {SyndicationPlatform} platform
 * @param {boolean} mockAuthAvailable
 */
export async function buildPlatformStatusFromAccounts(tenantId, platform, mockAuthAvailable) {
  const accounts = await listAccountsForTenant(tenantId, platform);
  const activeAccounts = accounts.filter((a) => a.status === "active");
  const pending = accounts.find((a) => a.status === "pending_selection");

  /** @type {Record<string, unknown>} */
  const base = {
    connected: accounts.some((a) => a.status === "active" || a.status === "pending_selection"),
    accounts: activeAccounts.map(({ id, displayName, status }) => ({ id, displayName, status })),
    pendingAccountId: pending?.id ?? null,
    mockAuthAvailable,
  };

  if (platform === "facebook") {
    const firstActive = activeAccounts[0];
    base.pageSelected = activeAccounts.length > 0;
    base.pageId = firstActive?.externalAccountId ?? null;
    base.pageName = firstActive?.displayName ?? null;
  } else if (platform === "instagram") {
    const firstActive = activeAccounts[0];
    base.accountSelected = activeAccounts.length > 0;
    base.businessAccountId = firstActive?.externalAccountId ?? null;
    base.username = firstActive?.displayName ?? null;
  } else if (platform === "tiktok") {
    base.username = activeAccounts[0]?.displayName ?? null;
  }

  const limits = await getSyndicationAccountLimitSummary(tenantId, platform);
  base.maxAccounts = limits.maxAccounts;
  base.accountCount = limits.accountCount;
  base.canAddAccount = limits.canAddAccount;

  return base;
}
