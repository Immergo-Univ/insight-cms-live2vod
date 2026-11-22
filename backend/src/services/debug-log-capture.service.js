/**
 * Debug log capture.
 *
 * Hooks process.stdout / process.stderr (so every console.* call and every direct
 * `process.stdout.write` is captured) and persists the lines to disk with a HARD size cap.
 *
 * Disk usage is bounded by two rotating segments:
 *   data/debug-logs/stdout.log    (current, <= 5 MB)
 *   data/debug-logs/stdout.1.log  (previous, <= 5 MB)
 * Total retained logs never exceed MAX_TOTAL_BYTES (10 MB). When the current segment is full it
 * becomes the previous one and the oldest data is discarded.
 *
 * IMPORTANT: this module installs itself on import and must be the FIRST import of the entrypoint,
 * so that top-level logs of every other module are captured too.
 *
 * Secrets (bearer tokens, api keys, passwords, ...) are redacted BEFORE the line is stored.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEBUG_LOG_DIR = path.join(__dirname, "..", "..", "data", "debug-logs");
const CURRENT_FILE = path.join(DEBUG_LOG_DIR, "stdout.log");
const PREVIOUS_FILE = path.join(DEBUG_LOG_DIR, "stdout.1.log");

/** Hard cap for all retained logs on disk. */
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_SEGMENT_BYTES = Math.floor(MAX_TOTAL_BYTES / 2);
/** Max bytes kept in memory waiting for the next flush (oldest are dropped first). */
const MAX_PENDING_BYTES = 1024 * 1024;
/** Max characters stored per line (longer lines are truncated). */
const MAX_LINE_CHARS = 8000;
const FLUSH_INTERVAL_MS = 1000;

/** @type {string[]} */
let pending = [];
let pendingBytes = 0;
let currentSize = 0;
let installed = false;
/** Incomplete trailing line per stream (writes that do not end with a newline). */
const partialLines = { stdout: "", stderr: "" };

const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Remove secrets from a log line before it is stored.
 * @param {string} line
 */
function redactSecrets(line) {
  return line
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "[redacted]")
    .replace(
      /((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization)["']?\s*[:=]\s*["']?)([^\s"',;&}]{4,})/gi,
      "$1[redacted]",
    );
}

/**
 * @param {"stdout" | "stderr"} stream
 * @param {string} line
 */
function pushLine(stream, line) {
  const clean = line.replace(ANSI_PATTERN, "");
  if (!clean.trim()) return;
  const text = `${new Date().toISOString()} ${stream === "stderr" ? "E" : "O"} ${redactSecrets(clean.slice(0, MAX_LINE_CHARS))}\n`;
  pending.push(text);
  pendingBytes += Buffer.byteLength(text);
  while (pendingBytes > MAX_PENDING_BYTES && pending.length > 1) {
    const dropped = pending.shift();
    pendingBytes -= Buffer.byteLength(dropped ?? "");
  }
}

/**
 * @param {"stdout" | "stderr"} stream
 * @param {unknown} chunk
 */
function ingest(stream, chunk) {
  const text =
    typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
  const parts = (partialLines[stream] + text).split(/\r?\n/);
  partialLines[stream] = parts.pop() ?? "";
  if (partialLines[stream].length > MAX_LINE_CHARS) {
    pushLine(stream, partialLines[stream]);
    partialLines[stream] = "";
  }
  for (const line of parts) pushLine(stream, line);
}

function rotate() {
  try {
    fs.rmSync(PREVIOUS_FILE, { force: true });
    fs.renameSync(CURRENT_FILE, PREVIOUS_FILE);
  } catch {
    try {
      fs.truncateSync(CURRENT_FILE, 0);
    } catch {
      /* ignore */
    }
  }
  currentSize = 0;
}

/** Write pending lines to disk synchronously, rotating when the current segment is full. */
export function flushDebugLogsSync() {
  if (pending.length === 0) return;
  const data = pending.join("");
  const bytes = Buffer.byteLength(data);
  pending = [];
  pendingBytes = 0;
  try {
    fs.mkdirSync(DEBUG_LOG_DIR, { recursive: true });
    if (currentSize + bytes > MAX_SEGMENT_BYTES) rotate();
    fs.appendFileSync(CURRENT_FILE, data);
    currentSize += bytes;
  } catch {
    // Logging must never crash the process.
  }
}

function flushPartialLines() {
  for (const stream of /** @type {const} */ (["stdout", "stderr"])) {
    if (partialLines[stream]) {
      pushLine(stream, partialLines[stream]);
      partialLines[stream] = "";
    }
  }
}

/** Hook stdout/stderr. Idempotent. */
export function installDebugLogCapture() {
  if (installed) return;
  installed = true;

  try {
    fs.mkdirSync(DEBUG_LOG_DIR, { recursive: true });
    currentSize = fs.existsSync(CURRENT_FILE) ? fs.statSync(CURRENT_FILE).size : 0;
    if (currentSize > MAX_SEGMENT_BYTES) rotate();
    if (fs.existsSync(PREVIOUS_FILE) && fs.statSync(PREVIOUS_FILE).size > MAX_SEGMENT_BYTES) {
      fs.rmSync(PREVIOUS_FILE, { force: true });
    }
  } catch {
    /* ignore: capture continues in best-effort mode */
  }

  for (const stream of /** @type {const} */ (["stdout", "stderr"])) {
    const target = process[stream];
    const originalWrite = target.write.bind(target);
    target.write = (chunk, ...rest) => {
      try {
        ingest(stream, chunk);
      } catch {
        /* never break the real write */
      }
      return originalWrite(chunk, ...rest);
    };
  }

  setInterval(flushDebugLogsSync, FLUSH_INTERVAL_MS).unref();
  process.on("exit", () => {
    flushPartialLines();
    flushDebugLogsSync();
  });
}

/**
 * Read the last lines captured (previous + current segment + not yet flushed).
 *
 * @param {{ lines?: number, grep?: string, stream?: "stdout" | "stderr" | "" }} [options]
 * @returns {{ lines: string[], totalMatched: number, bytesOnDisk: number }}
 */
export function readDebugLogs(options = {}) {
  flushPartialLines();
  flushDebugLogsSync();

  const limit = Math.max(1, Math.min(5000, Math.trunc(Number(options.lines) || 200)));
  const grep = String(options.grep || "").trim().toLowerCase();
  const streamTag = options.stream === "stderr" ? "E" : options.stream === "stdout" ? "O" : "";

  let raw = "";
  let bytesOnDisk = 0;
  for (const file of [PREVIOUS_FILE, CURRENT_FILE]) {
    try {
      const content = fs.readFileSync(file, "utf8");
      bytesOnDisk += Buffer.byteLength(content);
      raw += content;
    } catch {
      /* segment does not exist yet */
    }
  }

  let all = raw.split("\n").filter(Boolean);
  // Line format: "<ISO timestamp (24 chars)> <O|E> <message>"
  if (streamTag) all = all.filter((l) => l.charAt(25) === streamTag);
  if (grep) all = all.filter((l) => l.toLowerCase().includes(grep));

  return { lines: all.slice(-limit), totalMatched: all.length, bytesOnDisk };
}

installDebugLogCapture();
