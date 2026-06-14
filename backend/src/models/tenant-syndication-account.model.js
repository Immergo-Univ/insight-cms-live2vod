import { DataTypes } from "sequelize";

/**
 * Authorized social account for tenant syndication (multi-account per platform).
 *
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerTenantSyndicationAccountModel(sequelize) {
  if (sequelize.models.TenantSyndicationAccount) return sequelize.models.TenantSyndicationAccount;

  const TenantSyndicationAccount = sequelize.define(
    "TenantSyndicationAccount",
    {
      id: { type: DataTypes.STRING(36), primaryKey: true },
      tenantId: { type: DataTypes.STRING(128), allowNull: false },
      platform: { type: DataTypes.STRING(32), allowNull: false },
      externalAccountId: { type: DataTypes.STRING(128), allowNull: false },
      displayName: { type: DataTypes.STRING(255), allowNull: true },
      credentials: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "active" },
    },
    {
      tableName: "tenant_syndication_accounts",
      underscored: true,
      timestamps: true,
    },
  );

  if (sequelize.models.Tenant) {
    TenantSyndicationAccount.belongsTo(sequelize.models.Tenant, {
      foreignKey: "tenantId",
      targetKey: "tenantId",
      as: "tenant",
    });
  }

  return TenantSyndicationAccount;
}
