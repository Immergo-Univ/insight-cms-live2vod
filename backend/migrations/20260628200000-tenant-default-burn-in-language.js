/**
 * Default burn-in language when subtitlesDefaultBurnIn is enabled for new clips.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "subtitles_default_burn_in_language", {
    type: Sequelize.STRING(8),
    allowNull: false,
    defaultValue: "en",
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "subtitles_default_burn_in_language");
}
