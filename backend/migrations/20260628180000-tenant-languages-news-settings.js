/**
 * Tenant language pool + news settings (Languages / News admin tabs).
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "available_languages", {
    type: Sequelize.JSONB,
    allowNull: false,
    defaultValue: ["en", "es", "he"],
  });
  await queryInterface.addColumn("tenants", "news_button_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });
  await queryInterface.addColumn("tenants", "news_default_generate", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });

  // Migrate legacy transcript/news UI flag into news_button_enabled.
  await queryInterface.sequelize.query(`
    UPDATE tenants
    SET news_button_enabled = COALESCE(subtitles_transcript_news_ui_enabled, true)
    WHERE news_button_enabled IS DISTINCT FROM COALESCE(subtitles_transcript_news_ui_enabled, true);
  `);
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "news_default_generate");
  await queryInterface.removeColumn("tenants", "news_button_enabled");
  await queryInterface.removeColumn("tenants", "available_languages");
}
