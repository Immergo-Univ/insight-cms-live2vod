/**
 * Unique (role_id, entity, action) — Sequelize model index used camelCase columns; PG has role_id (underscored).
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS admin_role_permissions_role_entity_action_uq
    ON admin_role_permissions (role_id, entity, action);
  `);
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS admin_role_permissions_role_entity_action_uq`);
}
