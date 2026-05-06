/**
 * Per-tenant YouTube syndication flags (admin gate + mock OAuth connected state).
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "syndication_youtube_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "syndication_youtube_connected", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "syndication_youtube_enabled");
  await queryInterface.removeColumn("tenants", "syndication_youtube_connected");
}
