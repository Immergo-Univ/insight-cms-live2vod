import { DataTypes } from "sequelize";

/**
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerAdminRolePermissionModel(sequelize) {
  if (sequelize.models.AdminRolePermission) return sequelize.models.AdminRolePermission;

  return sequelize.define(
    "AdminRolePermission",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      roleId: { type: DataTypes.UUID, allowNull: false },
      entity: { type: DataTypes.STRING(64), allowNull: false },
      action: { type: DataTypes.STRING(32), allowNull: false },
      allowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: "admin_role_permissions",
      underscored: true,
      timestamps: true,
    },
  );
}
