/**
 * Per-tenant editor clip-row button visibility flags.
 *
 * - subtitles_burn_in_button_enabled: show the burn-in subtitles button (Subtitles tab).
 * - vertical_crop_button_enabled: show the vertical crop button (Syndication tab).
 * - widgets_button_enabled: show the widgets (text / image overlays) button (Syndication tab).
 *
 * All default to false so existing tenants start hidden until an admin opts in.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("tenants", "subtitles_burn_in_button_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "vertical_crop_button_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn("tenants", "widgets_button_enabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.removeColumn("tenants", "widgets_button_enabled");
  await queryInterface.removeColumn("tenants", "vertical_crop_button_enabled");
  await queryInterface.removeColumn("tenants", "subtitles_burn_in_button_enabled");
}
