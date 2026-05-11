/**
 * Persist full editor JSON spec on each VOD job (syndication per clip, etc.).
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("vod_jobs", "editor_spec", {
    type: Sequelize.JSONB,
    allowNull: true,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("vod_jobs", "editor_spec");
}
