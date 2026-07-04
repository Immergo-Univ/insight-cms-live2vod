/**
 * Minimal structured logger (stdout/stderr) without external dependencies.
 */

function line(level, msg, meta) {
  const ts = new Date().toISOString();
  const base = `${ts} [${level}] ${msg}`;
  if (meta && Object.keys(meta).length > 0) {
    try {
      return `${base} ${JSON.stringify(meta)}`;
    } catch {
      return base;
    }
  }
  return base;
}

export const logger = {
  info(msg, meta) {
    console.log(line("info", msg, meta));
  },
  warn(msg, meta) {
    console.warn(line("warn", msg, meta));
  },
  error(msg, meta) {
    console.error(line("error", msg, meta));
  },
  debug(msg, meta) {
    if (process.env.DEBUG) console.log(line("debug", msg, meta));
  },
};

export default logger;
