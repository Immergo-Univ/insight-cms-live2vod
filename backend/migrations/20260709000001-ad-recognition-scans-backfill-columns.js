/**
 * Idempotent backfill for `ad_recognition_scans`.
 *
 * The original create migration (20260705120000) uses `CREATE TABLE IF NOT EXISTS`, so instances
 * where the table was first materialized by `sequelize.sync()` (without `alter: true`) may be
 * missing any column that landed in the model AFTER the first sync ran. This migration walks
 * every non-primary column defined in the current model and adds it if it isn't already there —
 * `ADD COLUMN IF NOT EXISTS` (Postgres 9.6+) is safe to re-run on fresh databases where the
 * create migration already added the columns.
 *
 * NOTE: We intentionally add columns via raw SQL (not `queryInterface.addColumn`) because Sequelize
 * doesn't honor `IF NOT EXISTS` when going through the abstract API, and would throw on tables
 * that already have the column.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  const sql = queryInterface.sequelize;
  const alters = [
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS channel_title VARCHAR(512)",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS hls_url TEXT",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS detection VARCHAR(32) NOT NULL DEFAULT 'unknown'",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS score DOUBLE PRECISION",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS scores JSONB",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS transcript TEXT",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS ocr_text TEXT",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS profile JSONB",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS error TEXT",
    "ALTER TABLE ad_recognition_scans ADD COLUMN IF NOT EXISTS probe_epoch BIGINT",
  ];
  for (const stmt of alters) {
    await sql.query(stmt);
  }
}

/**
 * No-op down: we can't safely infer which columns predated this migration on a given DB, and
 * dropping them would risk data loss. Recreate the table from scratch if a full rollback is
 * needed.
 *
 * @param {import("sequelize").QueryInterface} _queryInterface
 */
export async function down(_queryInterface) {
  /* no-op */
}
