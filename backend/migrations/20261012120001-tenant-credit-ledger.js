/**
 * Persistent AI credit consumption ledger (per job / model / category).
 * Used for monthly free usage rollups and purchased-credit delta reconciliation.
 */

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const tableExists = tables.includes("tenant_credit_ledger");

  if (!tableExists) {
    await queryInterface.createTable("tenant_credit_ledger", {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      tenant_id: {
        type: Sequelize.STRING(128),
        allowNull: false,
        references: { model: "tenants", key: "tenant_id" },
        onDelete: "CASCADE",
      },
      period_month: {
        type: Sequelize.STRING(7),
        allowNull: false,
      },
      job_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      category: {
        type: Sequelize.STRING(16),
        allowNull: false,
      },
      model: {
        type: Sequelize.STRING(128),
        allowNull: false,
        defaultValue: "",
      },
      units: {
        type: Sequelize.DECIMAL(18, 4),
        allowNull: false,
        defaultValue: 0,
      },
      unit_kind: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: "tokens",
      },
      usd: {
        type: Sequelize.DECIMAL(18, 8),
        allowNull: false,
        defaultValue: 0,
      },
      credits: {
        type: Sequelize.DECIMAL(18, 6),
        allowNull: false,
        defaultValue: 0,
      },
      credits_from_free: {
        type: Sequelize.DECIMAL(18, 6),
        allowNull: false,
        defaultValue: 0,
      },
      credits_from_purchased: {
        type: Sequelize.DECIMAL(18, 6),
        allowNull: false,
        defaultValue: 0,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });
  }

  const indexes = await queryInterface.showIndex("tenant_credit_ledger");
  const indexNames = new Set(indexes.map((idx) => idx.name));

  if (!indexNames.has("tenant_credit_ledger_tenant_period_idx")) {
    await queryInterface.addIndex("tenant_credit_ledger", ["tenant_id", "period_month"], {
      name: "tenant_credit_ledger_tenant_period_idx",
    });
  }
  if (!indexNames.has("tenant_credit_ledger_job_id_idx")) {
    await queryInterface.addIndex("tenant_credit_ledger", ["job_id"], {
      name: "tenant_credit_ledger_job_id_idx",
    });
  }
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  const tables = await queryInterface.showAllTables();
  if (tables.includes("tenant_credit_ledger")) {
    await queryInterface.dropTable("tenant_credit_ledger");
  }
}
