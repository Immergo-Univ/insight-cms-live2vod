import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse aggregate "cpu" line from /proc/stat (Linux).
 * @param {string} line
 * @returns {{ idle: number, total: number } | null}
 */
function parseProcCpuAggregateLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== "cpu" || parts.length < 5) return null;
  const nums = parts.slice(1).map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  if (nums.length < 4) return null;
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
  const total = nums.reduce((sum, n) => sum + n, 0);
  return { idle, total };
}

async function readProcCpuAggregate() {
  try {
    const text = await readFile("/proc/stat", "utf8");
    const first = text.split("\n")[0] ?? "";
    return parseProcCpuAggregateLine(first);
  } catch {
    return null;
  }
}

/**
 * @param {number} value
 * @param {number} decimals
 */
function roundFixed(value, decimals) {
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

/**
 * Host metrics for health / diagnostics (Linux-friendly; degrades elsewhere).
 * @param {{ cpuSampleMs?: number, diskPath?: string }} [options]
 */
export async function collectSystemMetrics(options = {}) {
  const cpuSampleMs = options.cpuSampleMs ?? 100;
  const diskPath = options.diskPath ?? "/";
  const now = new Date();

  const [load1m, load5m, load15m] = os.loadavg();
  const logicalCores = os.cpus().length;

  const memoryTotalBytes = os.totalmem();
  const memoryFreeBytes = os.freemem();
  const memoryUsedBytes = memoryTotalBytes - memoryFreeBytes;
  const memoryUsagePercent =
    memoryTotalBytes > 0 ? roundFixed((100 * memoryUsedBytes) / memoryTotalBytes, 2) : null;

  let cpuUsagePercent = null;
  const t0 = await readProcCpuAggregate();
  if (t0) {
    await sleep(cpuSampleMs);
    const t1 = await readProcCpuAggregate();
    if (t1) {
      const idleDelta = t1.idle - t0.idle;
      const totalDelta = t1.total - t0.total;
      if (totalDelta > 0) {
        const raw = (100 * (totalDelta - idleDelta)) / totalDelta;
        cpuUsagePercent = roundFixed(Math.min(100, Math.max(0, raw)), 2);
      }
    }
  }

  /** @type {Record<string, unknown> | null} */
  let disk = null;
  try {
    const s = await statfs(diskPath);
    const bsize = Number(s.bsize);
    const blocks = Number(s.blocks);
    const bavail = Number(s.bavail);
    const totalBytes = blocks * bsize;
    const availBytes = bavail * bsize;
    const usedBytes = totalBytes - availBytes;
    disk = {
      path: diskPath,
      totalBytes,
      freeBytes: availBytes,
      usedBytes,
      usagePercent: totalBytes > 0 ? roundFixed((100 * usedBytes) / totalBytes, 2) : null,
    };
  } catch {
    disk = null;
  }

  return {
    time: { iso: now.toISOString(), unixMs: now.getTime() },
    cpu: {
      usagePercent: cpuUsagePercent,
      sampleIntervalMs: t0 ? cpuSampleMs : null,
      loadAverage: { "1m": load1m, "5m": load5m, "15m": load15m },
      logicalCores,
    },
    memory: {
      totalBytes: memoryTotalBytes,
      freeBytes: memoryFreeBytes,
      usedBytes: memoryUsedBytes,
      usagePercent: memoryUsagePercent,
    },
    disk,
  };
}
