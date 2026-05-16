/**
 * Per-tenant Instagram Business syndication flags and OAuth tokens.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "syndication_instagram_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_instagram_connected", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "instagram_user_access_token", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
  await queryInterface.addColumn("tenants", "instagram_business_account_id", {
    type: Sequelize.STRING(64),
    allowNull: true,
  });
  await queryInterface.addColumn("tenants", "instagram_username", {
    type: Sequelize.STRING(128),
    allowNull: true,
  });
  await queryInterface.addColumn("tenants", "instagram_page_id", {
    type: Sequelize.STRING(64),
    allowNull: true,
  });
  await queryInterface.addColumn("tenants", "instagram_page_access_token", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "syndication_instagram_enabled");
  await queryInterface.removeColumn("tenants", "syndication_instagram_connected");
  await queryInterface.removeColumn("tenants", "instagram_user_access_token");
  await queryInterface.removeColumn("tenants", "instagram_business_account_id");
  await queryInterface.removeColumn("tenants", "instagram_username");
  await queryInterface.removeColumn("tenants", "instagram_page_id");
  await queryInterface.removeColumn("tenants", "instagram_page_access_token");
}
