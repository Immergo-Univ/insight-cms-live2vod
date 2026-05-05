import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { ADMIN_ENTITIES, ADMIN_ACTIONS, SUPERADMIN_ROLE_SLUG } from "../constants/admin-permissions.js";

/**
 * @param {import("sequelize").Sequelize} sequelize
 */
export async function seedAdminIfNeeded(sequelize) {
  const { AdminUser, AdminRole, AdminRolePermission, AdminUserRole } = sequelize.models;

  const [role] = await AdminRole.findOrCreate({
    where: { slug: SUPERADMIN_ROLE_SLUG },
    defaults: { name: "Super Admin", description: "Full access to admin panel" },
  });

  const permCount = await AdminRolePermission.count({ where: { roleId: role.id } });
  if (permCount === 0) {
    const rows = [];
    for (const entity of ADMIN_ENTITIES) {
      for (const action of ADMIN_ACTIONS) {
        rows.push({ roleId: role.id, entity, action, allowed: true });
      }
    }
    await AdminRolePermission.bulkCreate(rows);
  }

  let user = await AdminUser.findOne({ where: { email: config.admin.adminEmail } });
  if (!user) {
    user = await AdminUser.create({
      email: config.admin.adminEmail,
      passwordHash: await bcrypt.hash(config.admin.adminPassword, 10),
      displayName: "Administrator",
      language: "es",
    });
  }

  const link = await AdminUserRole.findOne({ where: { userId: user.id, roleId: role.id } });
  if (!link) await AdminUserRole.create({ userId: user.id, roleId: role.id });
}
