import { DataTypes } from "sequelize";

/**
 * Registers the VOD / clip job model on the Sequelize instance.
 * Table is created/updated via `sequelize.sync()` at startup.
 *
 * @param {import("sequelize").Sequelize} sequelize
 * @returns {import("sequelize").ModelStatic<import("sequelize").Model>}
 */
export function registerVodJobModel(sequelize) {
  if (sequelize.models.VodJob) return /** @type {import("sequelize").ModelStatic<import("sequelize").Model>} */ (sequelize.models.VodJob);

  return sequelize.define(
    "VodJob",
    {
      id: { type: DataTypes.STRING, primaryKey: true },
      tenantId: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false },
      progress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      phase: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
      message: DataTypes.TEXT,
      error: DataTypes.TEXT,
      clipUrl: DataTypes.TEXT,
      s3Key: DataTypes.TEXT,
      s3Keys: DataTypes.JSONB,
      outputUrl: DataTypes.TEXT,
      outputUrls: DataTypes.JSONB,
      transcriptText: DataTypes.TEXT,
      transcriptNewsEn: DataTypes.TEXT,
      transcriptNewsEs: DataTypes.TEXT,
      transcriptNewsHe: DataTypes.TEXT,
      transcriptNewsError: DataTypes.TEXT,
      transcriptDiarization: DataTypes.JSONB,
      openaiClipUsage: DataTypes.JSONB,
      transcriptNewsBundle: DataTypes.JSONB,
      jobKind: DataTypes.STRING,
      editorClipId: DataTypes.STRING,
      /** insight-api Mongo VOD guid (also mirrored as editor_spec.__vodGuid). */
      vodGuid: DataTypes.STRING,
      /** Full editor job spec (clips, ads, syndication per clip, etc.). */
      editorSpec: DataTypes.JSONB,
    },
    {
      tableName: "vod_jobs",
      underscored: true,
      timestamps: true,
    },
  );
}
