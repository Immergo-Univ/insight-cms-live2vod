/**
 * Per-tenant, per-platform max syndication account limits (JSONB). Default applied in app code (5).
 */

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "syndication_account_max_by_platform", {
    type: Sequelize.JSONB,
    allowNull: true,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "syndication_account_max_by_platform");
}
