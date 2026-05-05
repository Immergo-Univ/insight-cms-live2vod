import { registerAdminRoleModel } from "./admin-role.model.js";
import { registerAdminUserModel } from "./admin-user.model.js";
import { registerAdminUserRoleModel } from "./admin-user-role.model.js";
import { registerAdminRolePermissionModel } from "./admin-role-permission.model.js";

/**
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerAdminModels(sequelize) {
  const AdminRole = registerAdminRoleModel(sequelize);
  const AdminUser = registerAdminUserModel(sequelize);
  const AdminUserRole = registerAdminUserRoleModel(sequelize);
  const AdminRolePermission = registerAdminRolePermissionModel(sequelize);

  AdminUser.belongsToMany(AdminRole, {
    through: AdminUserRole,
    foreignKey: "userId",
    otherKey: "roleId",
    as: "roles",
  });
  AdminRole.belongsToMany(AdminUser, {
    through: AdminUserRole,
    foreignKey: "roleId",
    otherKey: "userId",
    as: "users",
  });

  AdminRolePermission.belongsTo(AdminRole, { foreignKey: "roleId", as: "role" });
  AdminRole.hasMany(AdminRolePermission, { foreignKey: "roleId", as: "permissions" });

  AdminUser.belongsTo(AdminUser, { foreignKey: "createdById", as: "creator" });
}
