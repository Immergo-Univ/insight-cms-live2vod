/**
 * Persist Inworld TTS character usage reported by encoder-lite (parallel to openai_clip_usage).
 */

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  const table = await queryInterface.describeTable("vod_jobs");
  if (!table.tts_clip_usage) {
    await queryInterface.addColumn("vod_jobs", "tts_clip_usage", {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  }
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  const table = await queryInterface.describeTable("vod_jobs");
  if (table.tts_clip_usage) {
    await queryInterface.removeColumn("vod_jobs", "tts_clip_usage");
  }
}
