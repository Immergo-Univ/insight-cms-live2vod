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
      /** ad | program | unknown | error */
      detection: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "unknown" },
      /** Final averaged strategy score (0..1). */
      score: { type: DataTypes.FLOAT, allowNull: true },
      /** Channel ad/program threshold applied for this scan. */
      confidence: { type: DataTypes.FLOAT, allowNull: true },
      /** Per-strategy scores ({ logoAppearance, logoDisappearance, ocrRules }). */
      scores: { type: DataTypes.JSONB, allowNull: true },
      /** Raw full-screen OCR text of the analyzed frame. */
      ocrText: { type: DataTypes.TEXT, allowNull: true },
      /** English (NLLB) translation of the OCR text. */
      ocrTextTranslated: { type: DataTypes.TEXT, allowNull: true },
      /** Total scan time in milliseconds (performance). */
      elapsedMs: { type: DataTypes.INTEGER, allowNull: true },
      /** Per-strategy breakdown + stage timings (ffmpeg/sidecar) as returned by the detector. */
      strategyResults: { type: DataTypes.JSONB, allowNull: true },
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
