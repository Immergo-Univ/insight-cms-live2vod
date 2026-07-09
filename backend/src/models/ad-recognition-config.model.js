import { DataTypes } from "sequelize";

/**
 * Per-channel AD-recognition detection config (one row per channel).
 *
 * The `config` JSONB holds the rule-engine setup edited from the admin "Ad Recognition Setup" tab:
 *   {
 *     threshold: 0.5,
 *     logoAppearance:    { enabled, instances: [{ id, roi, hashSensitivity, samples[], ocr }] },
 *     logoDisappearance: { enabled, instances: [ ... same shape ... ] },
 *     ocrRules:          { enabled, groups: [{ id, conditions: [{ op, value, textSource }] }] }
 *   }
 * Sample descriptors embed the precomputed template pHash + OCR text so the microservice never has
 * to re-download the images at detect time.
 *
 * Table created/updated via `sequelize.sync()` at startup (and the matching migration).
 *
 * @param {import("sequelize").Sequelize} sequelize
 * @returns {import("sequelize").ModelStatic<import("sequelize").Model>}
 */
export function registerAdRecognitionConfigModel(sequelize) {
  if (sequelize.models.AdRecognitionConfig) {
    return /** @type {import("sequelize").ModelStatic<import("sequelize").Model>} */ (
      sequelize.models.AdRecognitionConfig
    );
  }

  return sequelize.define(
    "AdRecognitionConfig",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      tenantId: { type: DataTypes.STRING(128), allowNull: false },
      channelId: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      /** Full rule-engine config (strategies + threshold + sample descriptors). */
      config: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      tableName: "ad_recognition_configs",
      underscored: true,
      timestamps: true,
      indexes: [{ unique: true, fields: ["channel_id"] }, { fields: ["tenant_id"] }],
    },
  );
}
