import { DataTypes } from "sequelize";

/**
 * CMS / Live2VOD tenant (Insight customer code), keyed by tenant_id slug (e.g. rjr).
 *
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerTenantModel(sequelize) {
  if (sequelize.models.Tenant) return sequelize.models.Tenant;

  return sequelize.define(
    "Tenant",
    {
      tenantId: { type: DataTypes.STRING(128), primaryKey: true },
      subtitlesEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      timezoneLastSeen: { type: DataTypes.STRING(128), allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: true },
      firstSeenAt: { type: DataTypes.DATE, allowNull: true },
      lastSeenAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "tenants", underscored: true, timestamps: true },
  );
}
