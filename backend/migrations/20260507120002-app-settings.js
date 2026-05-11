/**
 * Global admin-editable settings (JSON), e.g. syndication defaults per RRSS.
 *
 * Note: Sequelize `sync()` may create this table first without DB-level defaults on
 * `created_at` / `updated_at`. The INSERT must supply timestamps, and we ALTER
 * columns so future ORM inserts get DEFAULT NOW().
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id SMALLINT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await queryInterface.sequelize.query(`
    ALTER TABLE app_settings
      ALTER COLUMN created_at SET DEFAULT NOW(),
      ALTER COLUMN updated_at SET DEFAULT NOW();
  `);

  await queryInterface.sequelize.query(`
    INSERT INTO app_settings (id, settings, created_at, updated_at)
    VALUES (1, '{}'::jsonb, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS app_settings`);
}
