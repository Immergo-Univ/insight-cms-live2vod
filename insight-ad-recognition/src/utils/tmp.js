/**
 * Per-request scratch directories under the OS temp dir.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function createWorkDir() {
  const dir = path.join(os.tmpdir(), "insight-ad-recognition", randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function removeWorkDir(dir) {
  if (!dir) return;
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* best effort cleanup */
  }
}

export default { createWorkDir, removeWorkDir };
