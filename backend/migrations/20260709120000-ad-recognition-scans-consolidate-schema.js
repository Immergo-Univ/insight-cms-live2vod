/**
 * Consolidate `ad_recognition_scans` to the audio-only (CLAP) schema.
 *
 * Historically the table was materialized in several ways depending on when each environment
 * first synced its database:
 *
 *   1. A never-shipped "v2" design (pHash + template matching + HMM) that left NOT NULL columns
 *      like `phash`, plus `best_ad_similarity`, `best_ad_template_id`, `best_noad_similarity`,
 *      `best_noad_template_id`, `observation`, `hmm_state`. These are not populated by the
 *      current model, so inserts fail with `null value in column "phash" violates not-null`.
 *   2. Early versions of the current design that were missing later additions to the model
 *      (`channel_title`, `hls_url`, `confidence`, `scores`, `transcript`, `ocr_text`,
 *      `profile`, `error`, `probe_epoch`) because `sequelize.sync()` without `alter: true`
 *      doesn't add columns to pre-existing tables and the original create migration used
 *      `CREATE TABLE IF NOT EXISTS`.
 *
 * This migration reconciles both cases in one shot, idempotently, so it's safe on fresh DBs
 * (where the original create migration already provisioned everything) AND on legacy DBs.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  const sql = queryInterface.sequelize;

  // ---- 1. Drop columns from the abandoned v2 (template matching + HMM) design ---------------
  // These are not part of the current audio-only model. `DROP COLUMN IF EXISTS` is idempotent
  // on Postgres 9.6+ and safely no-ops on fresh DBs that never had them.
  const dropStatements = [
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS phash",
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS best_ad_similarity",
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS best_ad_template_id",
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS best_noad_similarity",
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS best_noad_template_id",
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS observation",
    "ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS hmm_state",
  ];
  for (const stmt of dropStatements) {
    await sql.query(stmt);
  }

  // ---- 2. Add every non-primary column the current model expects, if missing ---------------
  // Kept in sync with `src/models/ad-recognition-scan.model.js`. Column types match the ones
  // Sequelize would create via `sync()` so `alter: true` runs are no-ops afterwards.
  //
  // We intentionally use raw SQL (not `queryInterface.addColumn`) because Sequelize's abstract
  // API doesn't honor `IF NOT EXISTS` and would throw on tables that already have the column.
  const addStatements = [
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
  for (const stmt of addStatements) {
    await sql.query(stmt);
  }

  // ---- 3. Ensure the retention/query indexes exist ----------------------------------------
  await sql.query(
    "CREATE INDEX IF NOT EXISTS ad_recognition_scans_channel_id_scanned_at ON ad_recognition_scans (channel_id, scanned_at)",
  );
  await sql.query(
    "CREATE INDEX IF NOT EXISTS ad_recognition_scans_tenant_id ON ad_recognition_scans (tenant_id)",
  );
}

/**
 * No-op down: we can't safely infer which columns predated this migration, and re-adding the v2
 * columns with NOT NULL constraints would break existing rows. Recreate the table from scratch
 * if a full rollback is needed.
 *
 * @param {import("sequelize").QueryInterface} _queryInterface
 */
export async function down(_queryInterface) {
  /* no-op */
}
