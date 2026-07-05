import { DataTypes } from "sequelize";

/**
 * One row per AD-recognition probe (every scheduler cycle, per channel). Stores the full detect
 * verdict + relevant signals so the admin can review the history of ad breaks for a channel.
 * Table is created/updated via `sequelize.sync()` at startup (and the matching migration).
 *
 * @param {import("sequelize").Sequelize} sequelize
 * @returns {import("sequelize").ModelStatic<import("sequelize").Model>}
 */
export function registerAdRecognitionScanModel(sequelize) {
  if (sequelize.models.AdRecognitionScan) {
    return /** @type {import("sequelize").ModelStatic<import("sequelize").Model>} */ (
      sequelize.models.AdRecognitionScan
    );
  }

  return sequelize.define(
    "AdRecognitionScan",
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      tenantId: { type: DataTypes.STRING(128), allowNull: false },
      channelId: { type: DataTypes.STRING(128), allowNull: false },
      channelTitle: { type: DataTypes.STRING(512), allowNull: true },
      /** The exact m3u8 URL that was probed (with the archive window when applicable). */
      hlsUrl: { type: DataTypes.TEXT, allowNull: true },
      /** ad | program | black | unknown | error */
      detection: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "unknown" },
      score: { type: DataTypes.FLOAT, allowNull: true },
      confidence: { type: DataTypes.FLOAT, allowNull: true },
      /** Per-category scores from the detect service. */
      scores: { type: DataTypes.JSONB, allowNull: true },
      transcript: { type: DataTypes.TEXT, allowNull: true },
      ocrText: { type: DataTypes.TEXT, allowNull: true },
      /** Full analysis profile (video/audio/vision/ocr metrics). */
      profile: { type: DataTypes.JSONB, allowNull: true },
      /** Populated only when the probe failed (detect/ffmpeg error). */
      error: { type: DataTypes.TEXT, allowNull: true },
      /** Unix epoch (seconds) reported by the detect service for this sample. */
      probeEpoch: { type: DataTypes.BIGINT, allowNull: true },
      /** When this service issued the probe. */
      scannedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: "ad_recognition_scans",
      underscored: true,
      timestamps: true,
      indexes: [
        { fields: ["channel_id", "scanned_at"] },
        { fields: ["tenant_id"] },
      ],
    },
  );
}
