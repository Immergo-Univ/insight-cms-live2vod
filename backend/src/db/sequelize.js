import { Sequelize } from "sequelize";
import { config } from "../config.js";
import { registerVodJobModel } from "../models/vod-job.model.js";
import { registerAdminModels } from "../models/register-admin-models.js";
import { registerTenantModel } from "../models/tenant.model.js";
import { registerTenantSyndicationAccountModel } from "../models/tenant-syndication-account.model.js";
import { registerAppSettingModel } from "../models/app-setting.model.js";
import { registerAdRecognitionScanModel } from "../models/ad-recognition-scan.model.js";
import { seedAdminIfNeeded } from "../services/admin-seed.service.js";
import { runPendingMigrations } from "./migration-runner.js";

/** @type {Sequelize | null} */
let sequelize = null;

/**
 * New Sequelize instance (not assigned to module singleton). Used by CLI migrate.
 * @returns {Sequelize | null}
 */
export function createPostgresSequelize() {
  if (!config.postgres.enabled) return null;
  const ssl = config.postgres.ssl;
  return new Sequelize(config.postgres.database, config.postgres.user, config.postgres.password, {
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
}

/**
 * @param {Sequelize} sq
 */
export function registerAllModels(sq) {
  registerVodJobModel(sq);
  registerAdminModels(sq);
  registerTenantModel(sq);
  registerTenantSyndicationAccountModel(sq);
  registerAppSettingModel(sq);
  registerAdRecognitionScanModel(sq);
}

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
 * Authenticate, register models, sync schema, run `migrations/*.js`, then seed admin.
 * @returns {Promise<Sequelize | null>}
 */
export async function initSequelizeAndSync() {
  if (!config.postgres.enabled) return null;

  sequelize = createPostgresSequelize();
  registerAllModels(sequelize);
  await sequelize.authenticate();
  await sequelize.sync(config.postgres.syncAlter ? { alter: true } : {});
  await runPendingMigrations(sequelize);
  await seedAdminIfNeeded(sequelize);
  return sequelize;
}

export async function closeSequelize() {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
  }
}
