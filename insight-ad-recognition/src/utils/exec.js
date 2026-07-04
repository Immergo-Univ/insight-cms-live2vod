/**
 * Promise wrapper around child_process.spawn with a hard timeout (SIGKILL).
 * Captures stdout/stderr as UTF-8 strings.
 */

import { spawn } from "node:child_process";

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {{ timeoutMs?: number, cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function run(bin, args, opts = {}) {
  const { timeoutMs = 20000, cwd, env } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin}: timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Like {@link run} but rejects on non-zero exit code.
 */
export async function runOrThrow(bin, args, opts = {}) {
  const res = await run(bin, args, opts);
  if (res.code !== 0) {
    const tail = (res.stderr || res.stdout || "").slice(-2000);
    throw new Error(`${bin} exited ${res.code}: ${tail}`);
  }
  return res;
}

export default { run, runOrThrow };
