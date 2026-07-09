import { DataTypes } from "sequelize";

/**
 * Auto-collected channel-logo samples used by the AD-recognition logo stage.
 *
 * The microservice auto-detects the logo ROI on confident "program" windows and returns a cropped
 * sample; the scheduler uploads that crop to S3 and records one row here. We keep up to
 * `LOGO_SAMPLES_TARGET` (default 30) rows per channel; once reached, collection stops and the
 * stored samples become the templates for logo present/absent matching (program -> ad boundary).
 *
 * Table created/updated via `sequelize.sync()` at startup (and the matching migration).
 *
 * @param {import("sequelize").Sequelize} sequelize
 * @returns {import("sequelize").ModelStatic<import("sequelize").Model>}
 */
export function registerChannelLogoSampleModel(sequelize) {
  if (sequelize.models.ChannelLogoSample) {
    return /** @type {import("sequelize").ModelStatic<import("sequelize").Model>} */ (
      sequelize.models.ChannelLogoSample
    );
  }

  return sequelize.define(
    "ChannelLogoSample",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      tenantId: { type: DataTypes.STRING(128), allowNull: false },
      channelId: { type: DataTypes.STRING(128), allowNull: false },
      /** S3 object key of the stored crop. */
      s3Key: { type: DataTypes.TEXT, allowNull: false },
      /** Public URL of the crop (for the admin catalog + microservice template fetch). */
      publicUrl: { type: DataTypes.TEXT, allowNull: true },
      /** Normalized ROI [x0,y0,x1,y1] the crop was taken from. */
      roi: { type: DataTypes.JSONB, allowNull: true },
      /** Detector confidence for this sample. */
      confidence: { type: DataTypes.FLOAT, allowNull: true },
      /** The exact m3u8 window the sample came from (debugging). */
      hlsUrl: { type: DataTypes.TEXT, allowNull: true },
      /** How this sample was produced: 'auto' (detector) or 'manual' (operator upload/replace). */
      source: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "auto" },
    },
    {
      tableName: "channel_logo_samples",
      underscored: true,
      timestamps: true,
      indexes: [{ fields: ["channel_id"] }, { fields: ["tenant_id"] }],
    },
  );
}
