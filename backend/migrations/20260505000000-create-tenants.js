/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id VARCHAR(128) PRIMARY KEY,
      subtitles_enabled BOOLEAN NOT NULL DEFAULT true,
      timezone_last_seen VARCHAR(128),
      metadata JSONB,
      first_seen_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS tenants`);
}
