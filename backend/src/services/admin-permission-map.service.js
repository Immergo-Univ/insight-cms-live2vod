import { Op } from "sequelize";
import { getSequelize } from "../db/sequelize.js";
import { ADMIN_ENTITIES, ADMIN_ACTIONS, SUPERADMIN_ROLE_SLUG } from "../constants/admin-permissions.js";

/**
 * Flat map `entity.action` -> boolean for sidebar and UI gates.
 * @param {string} userId
 */
export async function adminGetPermissionMapForUser(userId) {
  const sequelize = getSequelize();
  if (!sequelize || !userId) return {};
  const { AdminUser, AdminRole, AdminRolePermission } = sequelize.models;

  const user = await AdminUser.findByPk(userId, {
    include: [{ model: AdminRole, as: "roles", through: { attributes: [] }, required: false }],
  });
  if (!user) return {};

  const roles = user.roles || [];
  /** @type {Record<string, boolean>} */
  const map = {};
  for (const e of ADMIN_ENTITIES) {
    for (const a of ADMIN_ACTIONS) {
      map[`${e}.${a}`] = false;
    }
  }
  if (roles.some((r) => r.slug === SUPERADMIN_ROLE_SLUG)) {
    for (const k of Object.keys(map)) map[k] = true;
    return map;
  }
  const roleIds = roles.map((r) => r.id);
  if (roleIds.length === 0) return map;

  const rows = await AdminRolePermission.findAll({
    where: { roleId: { [Op.in]: roleIds }, allowed: true },
  });
  for (const row of rows) {
    const o = row.get({ plain: true });
    const key = `${o.entity}.${o.action}`;
    if (key in map) map[key] = true;
  }
  return map;
}
