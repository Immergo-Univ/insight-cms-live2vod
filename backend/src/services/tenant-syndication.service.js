import { getSequelize } from "../db/sequelize.js";

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
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
  return {
    youtube: { connected: plain.syndicationYoutubeConnected === true },
  };
}

/**
 * Mock OAuth: marks YouTube as connected for the tenant (no real YouTube API).
 *
 * @param {string} tenantId
 */
export async function mockAuthorizeYoutubeSyndication(tenantId) {
  const { Tenant } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.syndicationYoutubeConnected = true;
  await row.save();
  return getSyndicationStatusForTenant(id);
}
