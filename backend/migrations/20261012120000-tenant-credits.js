/**
 * Per-tenant AI credit limits:
 * - monthly_free_credits: free allowance that resets each UTC month (only consumed in that month)
 * - purchased_credits: paid balance that does not expire (rollover)
 */

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  const table = await queryInterface.describeTable("tenants");
  if (!table.monthly_free_credits) {
    await queryInterface.addColumn("tenants", "monthly_free_credits", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  }
  if (!table.purchased_credits) {
    await queryInterface.addColumn("tenants", "purchased_credits", {
      type: Sequelize.DECIMAL(14, 4),
      allowNull: false,
      defaultValue: 0,
    });
  }
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  const table = await queryInterface.describeTable("tenants");
  if (table.purchased_credits) {
    await queryInterface.removeColumn("tenants", "purchased_credits");
  }
  if (table.monthly_free_credits) {
    await queryInterface.removeColumn("tenants", "monthly_free_credits");
  }
}
