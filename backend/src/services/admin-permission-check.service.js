import { Op } from "sequelize";
import { SUPERADMIN_ROLE_SLUG } from "../constants/admin-permissions.js";
import { getSequelize } from "../db/sequelize.js";

/**
 * @param {string} userId
 * @param {string} entity
 * @param {string} action
 */
export async function adminUserHasPermission(userId, entity, action) {
  const sequelize = getSequelize();
  if (!sequelize || !userId) return false;
  const { AdminUser, AdminRole, AdminRolePermission } = sequelize.models;

  const user = await AdminUser.findByPk(userId, {
    include: [{ model: AdminRole, as: "roles", through: { attributes: [] }, required: false }],
  });
  if (!user) return false;
  const roles = user.roles || [];
  if (roles.some((r) => r.slug === SUPERADMIN_ROLE_SLUG)) return true;

  const roleIds = roles.map((r) => r.id);
  if (roleIds.length === 0) return false;

  const row = await AdminRolePermission.findOne({
    where: { roleId: { [Op.in]: roleIds }, entity, action, allowed: true },
  });
  return Boolean(row);
}
