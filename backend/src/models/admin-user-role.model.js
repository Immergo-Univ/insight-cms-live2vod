import { DataTypes } from "sequelize";

/**
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerAdminUserRoleModel(sequelize) {
  if (sequelize.models.AdminUserRole) return sequelize.models.AdminUserRole;

  return sequelize.define(
    "AdminUserRole",
    {
      userId: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      roleId: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    },
    { tableName: "admin_user_roles", underscored: true, timestamps: false },
  );
}
