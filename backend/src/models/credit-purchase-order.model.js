import { DataTypes } from "sequelize";

/**
 * Credit purchase order: requested by a tenant (pack / custom amount / Enterprise contact)
 * and approved or rejected by an admin. Approval adds `credits` to tenants.purchased_credits.
 *
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerCreditPurchaseOrderModel(sequelize) {
  if (sequelize.models.CreditPurchaseOrder) return sequelize.models.CreditPurchaseOrder;

  return sequelize.define(
    "CreditPurchaseOrder",
    {
      id: { type: DataTypes.STRING(36), primaryKey: true },
      orderNumber: { type: DataTypes.INTEGER, allowNull: false, autoIncrement: true, unique: true },
      tenantId: { type: DataTypes.STRING(128), allowNull: false },
      /** 'pack' | 'custom' | 'enterprise' */
      kind: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "pack" },
      packId: { type: DataTypes.STRING(32), allowNull: true },
      packName: { type: DataTypes.STRING(64), allowNull: true },
      credits: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      priceUsd: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      /** 'pending' | 'approved' | 'rejected' | 'cancelled' */
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "pending" },
      vodGuid: { type: DataTypes.STRING(128), allowNull: true },
      invoiceDetails: { type: DataTypes.JSONB, allowNull: true },
      contactDetails: { type: DataTypes.JSONB, allowNull: true },
      balanceAtRequest: { type: DataTypes.INTEGER, allowNull: true },
      adminNotes: { type: DataTypes.TEXT, allowNull: true },
      rejectReason: { type: DataTypes.TEXT, allowNull: true },
      createdByAdminId: { type: DataTypes.STRING(64), allowNull: true },
      reviewedByAdminId: { type: DataTypes.STRING(64), allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "credit_purchase_orders",
      underscored: true,
      timestamps: true,
    },
  );
}
