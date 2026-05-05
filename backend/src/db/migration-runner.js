/**
 * Runs pending SQL/JS migrations from `backend/migrations/` (tracked in SequelizeMeta).
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Sequelize } from "sequelize";
import { config } from "../config.js";

const META_TABLE = "SequelizeMeta";

/**
 * @param {import("sequelize").Sequelize} sequelize
 */
export async function runPendingMigrations(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS "${META_TABLE}" (
      "name" VARCHAR(255) NOT NULL PRIMARY KEY
    );
  `);

  const [doneRows] = await sequelize.query(`SELECT "name" FROM "${META_TABLE}"`);
  const done = new Set((doneRows || []).map((/** @type {{ name: string }} */ r) => r.name));

  const dir = path.join(config.backendRoot, "migrations");
  let files = [];
  try {
    files = (await readdir(dir))
      .filter((f) => f.endsWith(".js") && !f.startsWith("."))
      .sort();
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err.code === "ENOENT") return;
    throw e;
  }

  const queryInterface = sequelize.getQueryInterface();
  const SequelizeCtor = Sequelize;

  for (const file of files) {
    if (done.has(file)) continue;
    const full = path.join(dir, file);
    const mod = await import(pathToFileURL(full).href);
    if (typeof mod.up !== "function") continue;
    await mod.up(queryInterface, SequelizeCtor);
    await sequelize.query(`INSERT INTO "${META_TABLE}" ("name") VALUES ($1)`, { bind: [file] });
  }
}
