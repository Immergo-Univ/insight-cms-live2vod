import { Sequelize } from "sequelize";
import { config } from "../config.js";
import { registerVodJobModel } from "../models/vod-job.model.js";

/** @type {Sequelize | null} */
let sequelize = null;

export function getSequelize() {
  return sequelize;
}

export function isSequelizeReady() {
  return sequelize != null;
}

/**
 * @returns {import("sequelize").ModelStatic<import("sequelize").Model>}
 */
export function getVodJobModel() {
  if (!sequelize) throw new Error("Sequelize is not initialized");
  const M = sequelize.models.VodJob;
  if (!M) throw new Error("VodJob model is not registered");
  return /** @type {import("sequelize").ModelStatic<import("sequelize").Model>} */ (M);
}

/**
 * Authenticate, register models, and sync schema to the database.
 * @returns {Promise<Sequelize | null>}
 */
export async function initSequelizeAndSync() {
  if (!config.postgres.enabled) return null;

  const ssl = config.postgres.ssl;
  sequelize = new Sequelize(config.postgres.database, config.postgres.user, config.postgres.password, {
    host: config.postgres.host,
    port: config.postgres.port,
    dialect: "postgres",
    logging: false,
    pool: { max: config.postgres.poolMax, min: 0, idle: 10_000, acquire: 15_000 },
    dialectOptions: ssl
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: Boolean(ssl.rejectUnauthorized),
          },
        }
      : {},
  });

  registerVodJobModel(sequelize);
  await sequelize.authenticate();
  await sequelize.sync(config.postgres.syncAlter ? { alter: true } : {});
  await sequelize.query(
    "CREATE INDEX IF NOT EXISTS idx_vod_jobs_tenant_created ON vod_jobs (tenant_id, created_at DESC)",
  );
  return sequelize;
}

export async function closeSequelize() {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
  }
}
