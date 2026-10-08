/**
 * Per-tenant AI dubbing (Inworld) feature flags.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "dubbing_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "dubbing_default_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "available_dubbing_languages", {
    type: Sequelize.JSONB,
    allowNull: true,
    defaultValue: null,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "available_dubbing_languages");
  await queryInterface.removeColumn("tenants", "dubbing_default_enabled");
  await queryInterface.removeColumn("tenants", "dubbing_enabled");
}
