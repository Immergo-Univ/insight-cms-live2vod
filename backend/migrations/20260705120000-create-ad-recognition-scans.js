/**
 * History of AD-recognition probes (one row per channel per scheduler cycle). Backs the admin
 * "Streams" tab scan table. `sequelize.sync()` also creates this table from the model; this
 * migration keeps the schema explicit and idempotent.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS ad_recognition_scans (
      id BIGSERIAL PRIMARY KEY,
      tenant_id VARCHAR(128) NOT NULL,
      channel_id VARCHAR(128) NOT NULL,
      channel_title VARCHAR(512),
      hls_url TEXT,
      detection VARCHAR(32) NOT NULL DEFAULT 'unknown',
      score DOUBLE PRECISION,
      confidence DOUBLE PRECISION,
      scores JSONB,
      transcript TEXT,
      ocr_text TEXT,
      profile JSONB,
      error TEXT,
      probe_epoch BIGINT,
      scanned_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS ad_recognition_scans_channel_id_scanned_at ON ad_recognition_scans (channel_id, scanned_at);`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS ad_recognition_scans_tenant_id ON ad_recognition_scans (tenant_id);`,
  );
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ad_recognition_scans`);
}
