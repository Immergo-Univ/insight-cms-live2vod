#!/usr/bin/env node
/**
 * Ensures Playwright's Chromium exists after npm install (widget HTML→PNG).
 * Set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 to skip (e.g. CI without encode).
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
  process.stdout.write(
    "[backend] Skipping Playwright Chromium (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)\n",
  );
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync(
  process.execPath,
  [path.join(root, "node_modules/playwright/cli.js"), "install", "chromium"],
  { stdio: "inherit", cwd: root, env: process.env },
);
process.exit(r.status === null ? 1 : r.status);
