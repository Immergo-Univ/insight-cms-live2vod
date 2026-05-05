/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_vod_jobs_tenant_created
    ON vod_jobs (tenant_id, created_at DESC);
  `);
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_vod_jobs_tenant_created`);
}
