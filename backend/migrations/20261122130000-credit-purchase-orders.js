/**
 * Credit purchase orders requested by tenants from the AI page (packs, custom amounts or
 * Enterprise contact requests). Credits are only granted when an admin approves the order.
 */

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes("credit_purchase_orders")) {
    await queryInterface.createTable("credit_purchase_orders", {
      id: { type: Sequelize.STRING(36), primaryKey: true, allowNull: false },
      order_number: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, unique: true },
      tenant_id: { type: Sequelize.STRING(128), allowNull: false },
      kind: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "pack" },
      pack_id: { type: Sequelize.STRING(32), allowNull: true },
      pack_name: { type: Sequelize.STRING(64), allowNull: true },
      credits: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      price_usd: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "pending" },
      vod_guid: { type: Sequelize.STRING(128), allowNull: true },
      invoice_details: { type: Sequelize.JSONB, allowNull: true },
      contact_details: { type: Sequelize.JSONB, allowNull: true },
      balance_at_request: { type: Sequelize.INTEGER, allowNull: true },
      admin_notes: { type: Sequelize.TEXT, allowNull: true },
      reject_reason: { type: Sequelize.TEXT, allowNull: true },
      created_by_admin_id: { type: Sequelize.STRING(64), allowNull: true },
      reviewed_by_admin_id: { type: Sequelize.STRING(64), allowNull: true },
      reviewed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });
  }

  const indexes = await queryInterface.showIndex("credit_purchase_orders");
  const names = new Set(indexes.map((idx) => idx.name));
  if (!names.has("credit_purchase_orders_tenant_created_idx")) {
    await queryInterface.addIndex("credit_purchase_orders", ["tenant_id", "created_at"], {
      name: "credit_purchase_orders_tenant_created_idx",
    });
  }
  if (!names.has("credit_purchase_orders_status_idx")) {
    await queryInterface.addIndex("credit_purchase_orders", ["status"], {
      name: "credit_purchase_orders_status_idx",
    });
  }
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  const tables = await queryInterface.showAllTables();
  if (tables.includes("credit_purchase_orders")) {
    await queryInterface.dropTable("credit_purchase_orders");
  }
}
