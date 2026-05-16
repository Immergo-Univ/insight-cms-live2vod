import { getSequelize } from "../db/sequelize.js";
import { tenantRowToApi } from "./tenant-visit.service.js";

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
}

export async function adminListTenants() {
  const { Tenant } = models();
  const rows = await Tenant.findAll({ order: [["lastSeenAt", "DESC"]] });
  return rows.map((r) => tenantRowToApi(r.get({ plain: true })));
}

/**
 * @param {string} tenantId
 */
export async function adminGetTenant(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  return row ? tenantRowToApi(row.get({ plain: true })) : null;
}

/**
 * @param {string} tenantId
 * @param {object} body
 */
export async function adminUpdateTenant(tenantId, body) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  if (body.subtitlesEnabled !== undefined) row.subtitlesEnabled = Boolean(body.subtitlesEnabled);
  if (body.syndicationYoutubeEnabled !== undefined) {
    row.syndicationYoutubeEnabled = Boolean(body.syndicationYoutubeEnabled);
  }
  if (body.syndicationTwitterEnabled !== undefined) {
    row.syndicationTwitterEnabled = Boolean(body.syndicationTwitterEnabled);
  }
  if (body.syndicationFacebookEnabled !== undefined) {
    row.syndicationFacebookEnabled = Boolean(body.syndicationFacebookEnabled);
  }
  if (body.syndicationInstagramEnabled !== undefined) {
    row.syndicationInstagramEnabled = Boolean(body.syndicationInstagramEnabled);
  }
  if (body.syndicationTiktokEnabled !== undefined) {
    row.syndicationTiktokEnabled = Boolean(body.syndicationTiktokEnabled);
  }
  if (body.timezoneLastSeen !== undefined) row.timezoneLastSeen = body.timezoneLastSeen ? String(body.timezoneLastSeen).slice(0, 128) : null;
  if (body.metadata !== undefined) {
    row.metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : null;
  }
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

/**
 * Clear the tenant's YouTube OAuth refresh token and flip the connected flag off.
 * After this, the tenant must re-run the Google OAuth flow to publish again.
 *
 * @param {string} tenantId
 */
export async function adminDisconnectTenantYoutube(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  row.youtubeRefreshToken = null;
  row.syndicationYoutubeConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

/**
 * Clear the tenant's X OAuth refresh token and flip the connected flag off.
 *
 * @param {string} tenantId
 */
export async function adminDisconnectTenantTwitter(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  row.twitterRefreshToken = null;
  row.syndicationTwitterConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

/**
 * Clear the tenant's Facebook OAuth tokens and selected Page.
 *
 * @param {string} tenantId
 */
export async function adminDisconnectTenantFacebook(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  row.facebookUserAccessToken = null;
  row.facebookPageId = null;
  row.facebookPageAccessToken = null;
  row.facebookPageName = null;
  row.syndicationFacebookConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

/**
 * Clear the tenant's Instagram OAuth tokens and selected Business account.
 *
 * @param {string} tenantId
 */
export async function adminDisconnectTenantInstagram(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  row.instagramUserAccessToken = null;
  row.instagramBusinessAccountId = null;
  row.instagramUsername = null;
  row.instagramPageId = null;
  row.instagramPageAccessToken = null;
  row.syndicationInstagramConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

/**
 * Clear the tenant's TikTok OAuth tokens.
 *
 * @param {string} tenantId
 */
export async function adminDisconnectTenantTiktok(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  row.tiktokRefreshToken = null;
  row.tiktokOpenId = null;
  row.tiktokUsername = null;
  row.syndicationTiktokConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}
