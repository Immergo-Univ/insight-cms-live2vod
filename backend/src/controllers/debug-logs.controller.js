import crypto from "crypto";
import { Router } from "express";
import { MAX_TOTAL_BYTES, readDebugLogs } from "../services/debug-log-capture.service.js";

/**
 * Hardcoded access token for the debug endpoints (by design).
 * It can be overridden with the DEBUG_LOGS_TOKEN env var without touching the code.
 */
const DEBUG_LOGS_ACCESS_TOKEN = "37b567f3ee4e290c72d223fb217a429cb6e8e49c";

export const debugLogsRouter = Router();

/** @param {unknown} provided */
function isValidToken(provided) {
  const expected = Buffer.from(String(process.env.DEBUG_LOGS_TOKEN || DEBUG_LOGS_ACCESS_TOKEN));
  const received = Buffer.from(String(provided ?? ""));
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

/**
 * GET /api/debug/logs
 *   token   (required) access token; also accepted as `x-debug-token` header
 *   lines   last N lines to return (default 200, max 5000)
 *   grep    optional case-insensitive substring filter (applied before taking the last N)
 *   stream  optional: "stdout" | "stderr"
 *   format  "text" (default) | "json"
 *
 * Each line looks like: `2026-11-22T13:00:00.000Z O [vod:encode] ...` (O = stdout, E = stderr).
 */
debugLogsRouter.get("/logs", (req, res) => {
  const provided = req.query.token ?? req.headers["x-debug-token"];
  if (!isValidToken(provided)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const stream = req.query.stream === "stderr" ? "stderr" : req.query.stream === "stdout" ? "stdout" : "";
  const result = readDebugLogs({
    lines: Number(req.query.lines),
    grep: typeof req.query.grep === "string" ? req.query.grep : "",
    stream,
  });

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Log-Bytes-On-Disk", String(result.bytesOnDisk));
  res.setHeader("X-Log-Max-Bytes", String(MAX_TOTAL_BYTES));
  res.setHeader("X-Log-Matched-Lines", String(result.totalMatched));

  if (req.query.format === "json") {
    return res.json({
      returned: result.lines.length,
      matched: result.totalMatched,
      bytesOnDisk: result.bytesOnDisk,
      maxBytes: MAX_TOTAL_BYTES,
      lines: result.lines,
    });
  }
  res.type("text/plain; charset=utf-8").send(result.lines.join("\n") + (result.lines.length ? "\n" : ""));
});
