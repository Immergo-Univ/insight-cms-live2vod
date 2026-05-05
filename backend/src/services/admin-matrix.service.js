import { getSequelize } from "../db/sequelize.js";
import { ADMIN_ENTITIES, ADMIN_ACTIONS } from "../constants/admin-permissions.js";

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
}

/**
 * @param {string} roleId
 */
export async function adminGetPermissionMatrix(roleId) {
  const { AdminRolePermission } = models();
  const rows = await AdminRolePermission.findAll({ where: { roleId } });
  /** @type {Record<string, Record<string, boolean>>} */
  const matrix = {};
  for (const e of ADMIN_ENTITIES) {
    matrix[e] = {};
    for (const a of ADMIN_ACTIONS) matrix[e][a] = false;
  }
  for (const r of rows) {
    const o = r.get({ plain: true });
    if (!matrix[o.entity]) matrix[o.entity] = {};
    matrix[o.entity][o.action] = Boolean(o.allowed);
  }
  return { entities: [...ADMIN_ENTITIES], actions: [...ADMIN_ACTIONS], matrix };
}

/**
 * @param {string} roleId
 * @param {Record<string, Record<string, boolean>>} matrix
 */
export async function adminSavePermissionMatrix(roleId, matrix) {
  const { AdminRolePermission } = models();
  for (const entity of ADMIN_ENTITIES) {
    const row = matrix[entity] || {};
    for (const action of ADMIN_ACTIONS) {
      const allowed = Boolean(row[action]);
      const [rec] = await AdminRolePermission.findOrCreate({
        where: { roleId, entity, action },
        defaults: { roleId, entity, action, allowed },
      });
      if (rec.allowed !== allowed) {
        rec.allowed = allowed;
        await rec.save();
      }
    }
  }
  return adminGetPermissionMatrix(roleId);
}
