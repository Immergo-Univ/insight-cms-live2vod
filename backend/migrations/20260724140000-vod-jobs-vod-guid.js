/**
 * Persist insight-api VOD guid on vod_jobs (also mirrored as editor_spec.__vodGuid).
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    ALTER TABLE vod_jobs ADD COLUMN IF NOT EXISTS vod_guid VARCHAR(255);
  `);
  await queryInterface.sequelize.query(`
    UPDATE vod_jobs
    SET vod_guid = editor_spec->>'__vodGuid'
    WHERE (vod_guid IS NULL OR vod_guid = '')
      AND editor_spec IS NOT NULL
      AND editor_spec->>'__vodGuid' IS NOT NULL
      AND editor_spec->>'__vodGuid' <> '';
  `);
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(`
    ALTER TABLE vod_jobs DROP COLUMN IF EXISTS vod_guid;
  `);
}
