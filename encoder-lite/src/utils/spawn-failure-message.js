/**
 * Build a user-visible error when a spawned process exits non-zero.
 * Empty stderr is common with SIGKILL (OOM), bad URLs, or ffmpeg builds that log elsewhere.
 *
 * @param {object} p
 * @param {string} p.commandLabel e.g. "ffmpeg", "ffprobe", "whisper-cli"
 * @param {number | null} p.code exit code (null if killed)
 * @param {string | null | undefined} p.signal e.g. "SIGKILL"
 * @param {string} [p.stderr]
 * @returns {string}
 */
export function spawnFailureMessage({ commandLabel, code, signal, stderr }) {
  const tail = String(stderr ?? "").trim();
  if (tail) {
    return tail.length > 2000 ? `${tail.slice(0, 2000)}…` : tail;
  }
  if (signal) {
    return `${commandLabel} was terminated by ${signal} with no stderr captured. Often OOM, timeout, or cancel (SIGKILL).`;
  }
  const c = code === null || code === undefined ? "unknown" : String(code);
  return `${commandLabel} exited with code ${c} and no stderr output. Check that ${commandLabel} is installed, the input URL is reachable from the encoder, and the process has enough memory.`;
}
