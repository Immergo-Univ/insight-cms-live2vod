/**
 * Per-tenant subtitle feature flags and default clip subtitle options.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "subtitles_transcript_news_ui_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });
  await queryInterface.addColumn("tenants", "subtitles_default_burn_in", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "subtitles_default_diarization", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });
  await queryInterface.addColumn("tenants", "subtitles_default_infer_speaker_names", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "subtitles_default_news_en", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });
  await queryInterface.addColumn("tenants", "subtitles_default_news_es", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });
  await queryInterface.addColumn("tenants", "subtitles_default_news_he", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "subtitles_default_news_he");
  await queryInterface.removeColumn("tenants", "subtitles_default_news_es");
  await queryInterface.removeColumn("tenants", "subtitles_default_news_en");
  await queryInterface.removeColumn("tenants", "subtitles_default_infer_speaker_names");
  await queryInterface.removeColumn("tenants", "subtitles_default_diarization");
  await queryInterface.removeColumn("tenants", "subtitles_default_burn_in");
  await queryInterface.removeColumn("tenants", "subtitles_transcript_news_ui_enabled");
}
