/**
 * Per-tenant X (Twitter) syndication flags and OAuth refresh token.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "syndication_twitter_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_twitter_connected", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "twitter_refresh_token", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "syndication_twitter_enabled");
  await queryInterface.removeColumn("tenants", "syndication_twitter_connected");
  await queryInterface.removeColumn("tenants", "twitter_refresh_token");
}
