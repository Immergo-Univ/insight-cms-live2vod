/**
 * Backfill migration: adds `channel_title` (and any other newer columns that were introduced
 * in the model after the initial table was created) to `ad_recognition_scans`.
 *
 * The original create migration (20260705120000) uses `CREATE TABLE IF NOT EXISTS`, so instances
 * where the table was first materialized by `sequelize.sync()` (without `alter: true`) miss any
 * column added later. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is idempotent on Postgres 9.6+
 * and safe to re-run on fresh databases where the create migration already added the column.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  const sql = queryInterface.sequelize;
  await sql.query(
    `ALTER TABLE ad_recognition_scans
       ADD COLUMN IF NOT EXISTS channel_title VARCHAR(512);`,
  );
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    `ALTER TABLE ad_recognition_scans DROP COLUMN IF EXISTS channel_title;`,
  );
}
