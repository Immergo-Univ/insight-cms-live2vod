import { DataTypes } from "sequelize";

/**
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerAdminRoleModel(sequelize) {
  if (sequelize.models.AdminRole) return sequelize.models.AdminRole;

  return sequelize.define(
    "AdminRole",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      slug: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: "admin_roles", underscored: true, timestamps: true },
  );
}
