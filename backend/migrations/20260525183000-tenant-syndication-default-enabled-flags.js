/**
 * Per-tenant default-enabled toggles for subtitles and syndication.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "subtitles_default_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_youtube_default_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_twitter_default_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_facebook_default_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_instagram_default_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_tiktok_default_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "subtitles_default_enabled");
  await queryInterface.removeColumn("tenants", "syndication_youtube_default_enabled");
  await queryInterface.removeColumn("tenants", "syndication_twitter_default_enabled");
  await queryInterface.removeColumn("tenants", "syndication_facebook_default_enabled");
  await queryInterface.removeColumn("tenants", "syndication_instagram_default_enabled");
  await queryInterface.removeColumn("tenants", "syndication_tiktok_default_enabled");
}
