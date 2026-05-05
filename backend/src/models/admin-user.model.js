import { DataTypes } from "sequelize";

/**
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerAdminUserModel(sequelize) {
  if (sequelize.models.AdminUser) return sequelize.models.AdminUser;

  return sequelize.define(
    "AdminUser",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      email: { type: DataTypes.STRING(320), allowNull: false, unique: true },
      passwordHash: { type: DataTypes.STRING(255), allowNull: false },
      displayName: { type: DataTypes.STRING(200), allowNull: true },
      avatarUrl: { type: DataTypes.TEXT, allowNull: true },
      language: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "es" },
      createdById: { type: DataTypes.UUID, allowNull: true },
    },
    { tableName: "admin_users", underscored: true, timestamps: true },
  );
}
