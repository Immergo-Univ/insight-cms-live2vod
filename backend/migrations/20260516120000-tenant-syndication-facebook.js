/**
 * Per-tenant Facebook Page syndication flags and OAuth tokens.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "syndication_facebook_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_facebook_connected", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "facebook_user_access_token", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
  await queryInterface.addColumn("tenants", "facebook_page_id", {
    type: Sequelize.STRING(64),
    allowNull: true,
  });
  await queryInterface.addColumn("tenants", "facebook_page_access_token", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
  await queryInterface.addColumn("tenants", "facebook_page_name", {
    type: Sequelize.STRING(255),
    allowNull: true,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "syndication_facebook_enabled");
  await queryInterface.removeColumn("tenants", "syndication_facebook_connected");
  await queryInterface.removeColumn("tenants", "facebook_user_access_token");
  await queryInterface.removeColumn("tenants", "facebook_page_id");
  await queryInterface.removeColumn("tenants", "facebook_page_access_token");
  await queryInterface.removeColumn("tenants", "facebook_page_name");
}
