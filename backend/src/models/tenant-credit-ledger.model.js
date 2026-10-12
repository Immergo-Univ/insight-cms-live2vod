import { DataTypes } from "sequelize";

/**
 * Per-job AI credit consumption rows (Whisper / LLM / TTS), used for monthly free rollups
 * and purchased-credit balance reconciliation.
 *
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerTenantCreditLedgerModel(sequelize) {
  if (sequelize.models.TenantCreditLedger) return sequelize.models.TenantCreditLedger;

  const TenantCreditLedger = sequelize.define(
    "TenantCreditLedger",
    {
      id: { type: DataTypes.STRING(36), primaryKey: true },
      tenantId: { type: DataTypes.STRING(128), allowNull: false },
      periodMonth: { type: DataTypes.STRING(7), allowNull: false },
      jobId: { type: DataTypes.STRING(64), allowNull: true },
      category: { type: DataTypes.STRING(16), allowNull: false },
      model: { type: DataTypes.STRING(128), allowNull: false, defaultValue: "" },
      units: { type: DataTypes.DECIMAL(18, 4), allowNull: false, defaultValue: 0 },
      unitKind: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "tokens" },
      usd: { type: DataTypes.DECIMAL(18, 8), allowNull: false, defaultValue: 0 },
      credits: { type: DataTypes.DECIMAL(18, 6), allowNull: false, defaultValue: 0 },
      creditsFromFree: { type: DataTypes.DECIMAL(18, 6), allowNull: false, defaultValue: 0 },
      creditsFromPurchased: { type: DataTypes.DECIMAL(18, 6), allowNull: false, defaultValue: 0 },
      createdAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: "tenant_credit_ledger",
      underscored: true,
      timestamps: true,
      updatedAt: false,
    },
  );

  if (sequelize.models.Tenant) {
    TenantCreditLedger.belongsTo(sequelize.models.Tenant, {
      foreignKey: "tenantId",
      targetKey: "tenantId",
      as: "tenant",
    });
  }

  return TenantCreditLedger;
}
