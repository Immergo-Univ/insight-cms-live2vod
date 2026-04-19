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
 * Uses BigInt: raw jiffies exceed Number.MAX_SAFE_INTEGER on long-lived hosts; Number() loses deltas.
 * @param {string} line
 * @returns {{ idle: bigint, total: bigint } | null}
 */
function parseProcCpuAggregateLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== "cpu" || parts.length < 5) return null;
  /** @type {bigint[]} */
  const nums = [];
  for (const x of parts.slice(1)) {
    try {
      nums.push(BigInt(x));
    } catch {
      return null;
    }
  }
  if (nums.length < 4) return null;
  const idle = (nums[3] ?? 0n) + (nums[4] ?? 0n);
  const total = nums.reduce((sum, n) => sum + n, 0n);
  return { idle, total };
}

async function readProcCpuAggregate() {
  try {
    const text = await readFile("/proc/stat", "utf8");
    for (const line of text.split("\n")) {
      const parsed = parseProcCpuAggregateLine(line);
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sum per-CPU times from os.cpus() (fallback when /proc deltas are unusable or off-Linux).
 * @returns {{ idle: bigint, total: bigint } | null}
 */
function readOsCpuAggregate() {
  const cpus = os.cpus();
  if (!cpus.length) return null;
  let idle = 0n;
  let total = 0n;
  for (const { times } of cpus) {
    for (const [k, v] of Object.entries(times)) {
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      const n = BigInt(Math.trunc(v));
      total += n;
      if (k === "idle" || k === "iowait") idle += n;
    }
  }
  return { idle, total };
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

  /**
   * @param {() => Promise<{ idle: bigint, total: bigint } | null>} reader
   * @returns {Promise<{ percent: number | null, didSample: boolean }>}
   */
  async function sampleCpuUsage(reader) {
    const t0 = await reader();
    if (!t0) return { percent: null, didSample: false };
    await sleep(cpuSampleMs);
    const t1 = await reader();
    if (!t1) return { percent: null, didSample: true };
    const idleDelta = t1.idle - t0.idle;
    const totalDelta = t1.total - t0.total;
    if (totalDelta <= 0n) return { percent: null, didSample: true };
    const busyDelta = totalDelta - idleDelta;
    const raw = (100 * Number(busyDelta)) / Number(totalDelta);
    return { percent: roundFixed(Math.min(100, Math.max(0, raw)), 2), didSample: true };
  }

  const procTry = await sampleCpuUsage(readProcCpuAggregate);
  let cpuUsagePercent = procTry.percent;
  let cpuSampled = procTry.didSample;
  if (cpuUsagePercent === null) {
    const osTry = await sampleCpuUsage(async () => readOsCpuAggregate());
    cpuUsagePercent = osTry.percent;
    cpuSampled = cpuSampled || osTry.didSample;
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
      sampleIntervalMs: cpuSampled ? cpuSampleMs : null,
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
