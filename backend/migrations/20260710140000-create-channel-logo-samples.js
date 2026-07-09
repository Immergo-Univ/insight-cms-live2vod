/**
 * Channel logo samples: auto-collected logo ROI crops per channel (up to ~30), used by the
 * AD-recognition logo stage to detect when the channel logo disappears (program -> ad).
 *
 * `sequelize.sync()` also creates this table from the model; this migration keeps the schema
 * explicit and idempotent.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS channel_logo_samples (
      id BIGSERIAL PRIMARY KEY,
      tenant_id VARCHAR(128) NOT NULL,
      channel_id VARCHAR(128) NOT NULL,
      s3_key TEXT NOT NULL,
      public_url TEXT,
      roi JSONB,
      confidence DOUBLE PRECISION,
      hls_url TEXT,
      source VARCHAR(16) NOT NULL DEFAULT 'auto',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS channel_logo_samples_channel_id ON channel_logo_samples (channel_id);`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS channel_logo_samples_tenant_id ON channel_logo_samples (tenant_id);`,
  );
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS channel_logo_samples`);
}
