/**
 * Build a user-visible error when a spawned process exits non-zero.
 * Empty stderr is common when the process is killed or uses illegal instructions before logging.
 *
 * @param {object} p
 * @param {string} p.commandLabel e.g. "ffmpeg", "ffprobe"
 * @param {number | null} p.code exit code (null if killed)
 * @param {string | null | undefined} p.signal e.g. "SIGKILL"
 * @param {string} [p.stderr]
 * @returns {string}
 */
function signalHint(signal) {
  switch (signal) {
    case "SIGILL":
      return " Illegal instruction: the binary likely targets a newer CPU than this host. Rebuild with portable compiler flags.";
    case "SIGKILL":
      return " Often OOM, timeout, or explicit cancel.";
    case "SIGTERM":
      return " Received SIGTERM (graceful stop or orchestrator).";
    case "SIGSEGV":
      return " Segmentation fault (incompatible binary, bad model path, or library bug).";
    default:
      return "";
  }
}

export function spawnFailureMessage({ commandLabel, code, signal, stderr }) {
  const tail = String(stderr ?? "").trim();
  if (tail) {
    return tail.length > 2000 ? `${tail.slice(0, 2000)}…` : tail;
  }
  if (signal) {
    const hint = signalHint(signal);
    return `${commandLabel} was terminated by ${signal} with no stderr captured.${hint}`;
  }
  const c = code === null || code === undefined ? "unknown" : String(code);
  return `${commandLabel} exited with code ${c} and no stderr output. Check that ${commandLabel} is installed, the input URL is reachable from the encoder, and the process has enough memory.`;
}
