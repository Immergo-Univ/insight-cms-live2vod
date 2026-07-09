/**
 * Add multimodal signal columns to `ad_recognition_scans`.
 *
 * The pipeline now fuses visual (SigLIP), OCR cues, commercial-overlay detection, semantic text
 * (mDeBERTa) and audio (CLAP). Most of the detail lives in the `profile` JSONB, but these four
 * high-value signals are surfaced as dedicated columns so the admin can filter/aggregate on them.
 *
 * `ADD COLUMN IF NOT EXISTS` is idempotent on Postgres 9.6+ and safe on fresh DBs where
 * `sequelize.sync()` already created the columns from the model.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  const sql = queryInterface.sequelize;
  const alters = [
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS visual_category VARCHAR(64)",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS audio_category VARCHAR(64)",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS ocr_ad_cue_count INTEGER",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS overlay_present BOOLEAN",
  ];
  for (const stmt of alters) {
    await sql.query(stmt);
  }
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  const sql = queryInterface.sequelize;
  const drops = [
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS visual_category",
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS audio_category",
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS ocr_ad_cue_count",
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS overlay_present",
  ];
  for (const stmt of drops) {
    await sql.query(stmt);
  }
}
