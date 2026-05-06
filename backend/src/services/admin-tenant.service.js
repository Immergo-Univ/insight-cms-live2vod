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
  if (body.timezoneLastSeen !== undefined) row.timezoneLastSeen = body.timezoneLastSeen ? String(body.timezoneLastSeen).slice(0, 128) : null;
  if (body.metadata !== undefined) {
    row.metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : null;
  }
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}
