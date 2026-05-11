import { DataTypes } from "sequelize";

/**
 * Single-row application settings (admin UI).
 *
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerAppSettingModel(sequelize) {
  if (sequelize.models.AppSetting) return sequelize.models.AppSetting;

  return sequelize.define(
    "AppSetting",
    {
      id: { type: DataTypes.SMALLINT, primaryKey: true, defaultValue: 1 },
      settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    { tableName: "app_settings", underscored: true, timestamps: true },
  );
}
