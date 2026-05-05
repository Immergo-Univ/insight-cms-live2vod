/**
 * CLI: apply Sequelize sync + pending migrations (no HTTP server, no admin seed).
 * Usage: npm run db:migrate
 */

import { config } from "../config.js";
import { createPostgresSequelize, registerAllModels } from "./sequelize.js";
import { runPendingMigrations } from "./migration-runner.js";

async function main() {
  if (!config.postgres.enabled) {
    console.error("Postgres is not configured (POSTGRES_HOST + POSTGRES_DB).");
    process.exit(1);
  }
  const sq = createPostgresSequelize();
  if (!sq) process.exit(1);
  registerAllModels(sq);
  await sq.authenticate();
  await sq.sync(config.postgres.syncAlter ? { alter: true } : {});
  await runPendingMigrations(sq);
  await sq.close();
  console.log("db:migrate finished.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
