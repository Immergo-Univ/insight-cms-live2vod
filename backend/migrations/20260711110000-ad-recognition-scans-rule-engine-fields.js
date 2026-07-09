/**
 * Rule-engine scan fields: the detector now returns a per-strategy breakdown, an English OCR
 * translation and the total scan time. Older multimodal columns (visual_category, overlay_present,
 * ocr_ad_cue_count, transcript, audio_category) are left in place (nullable) for back-compat.
 *
 * Idempotent: `ADD COLUMN IF NOT EXISTS`.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    ALTER TABLE ad_recognition_scans
      ADD COLUMN IF NOT EXISTS ocr_text_translated TEXT,
      ADD COLUMN IF NOT EXISTS elapsed_ms INTEGER,
      ADD COLUMN IF NOT EXISTS strategy_results JSONB;
  `);
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(`
    ALTER TABLE ad_recognition_scans
      DROP COLUMN IF EXISTS ocr_text_translated,
      DROP COLUMN IF EXISTS elapsed_ms,
      DROP COLUMN IF EXISTS strategy_results;
  `);
}
