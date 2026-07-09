/**
 * Per-channel AD-recognition detection config (rule engine: logo appearance / disappearance / OCR
 * rules + threshold). One row per channel; `config` is the full JSONB setup edited from the admin
 * "Ad Recognition Setup" tab.
 *
 * `sequelize.sync()` also creates this table from the model; this migration keeps the schema
 * explicit and idempotent.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS ad_recognition_configs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id VARCHAR(128) NOT NULL,
      channel_id VARCHAR(128) NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ad_recognition_configs_channel_id ON ad_recognition_configs (channel_id);`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS ad_recognition_configs_tenant_id ON ad_recognition_configs (tenant_id);`,
  );
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ad_recognition_configs`);
}
