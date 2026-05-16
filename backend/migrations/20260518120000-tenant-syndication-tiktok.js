/**
 * Per-tenant TikTok syndication flags and OAuth refresh token.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "syndication_tiktok_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_tiktok_connected", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "tiktok_refresh_token", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
  await queryInterface.addColumn("tenants", "tiktok_open_id", {
    type: Sequelize.STRING(64),
    allowNull: true,
  });
  await queryInterface.addColumn("tenants", "tiktok_username", {
    type: Sequelize.STRING(128),
    allowNull: true,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "syndication_tiktok_enabled");
  await queryInterface.removeColumn("tenants", "syndication_tiktok_connected");
  await queryInterface.removeColumn("tenants", "tiktok_refresh_token");
  await queryInterface.removeColumn("tenants", "tiktok_open_id");
  await queryInterface.removeColumn("tenants", "tiktok_username");
}
