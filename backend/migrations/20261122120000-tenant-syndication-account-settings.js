/**
 * Per-account syndication settings (YouTube publish metadata lives here).
 */

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes("tenant_syndication_accounts")) return;

  const description = await queryInterface.describeTable("tenant_syndication_accounts");
  if (description.settings) return;

  await queryInterface.addColumn("tenant_syndication_accounts", "settings", {
    type: Sequelize.JSONB,
    allowNull: false,
    defaultValue: {},
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes("tenant_syndication_accounts")) return;
  const description = await queryInterface.describeTable("tenant_syndication_accounts");
  if (!description.settings) return;
  await queryInterface.removeColumn("tenant_syndication_accounts", "settings");
}
