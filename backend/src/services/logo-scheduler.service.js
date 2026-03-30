/**
 * Periodic archive-window probe using logo-detector (no legacy template-matching binary).
 * Opt-in: LOGO_SCAN_ENABLED=true. Skips any channel without uploaded logo templates.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive } from "./channels.service.js";
import {
  buildArchiveM3u8,
  resolveChannelLogoPathsForMatching,
  runLogoDetectorOnStream,
} from "./logo-pipeline.service.js";
import {
  mergeChannelSnapshotFields,
  readChannelSnapshotById,
  resolveHlsBaseUrl,
} from "./channel-ads-disk.service.js";

let schedulerRunning = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadScanState() {
  try {
    const raw = await fs.readFile(config.logoArchiveScan.stateFilePath, "utf8");
    const o = JSON.parse(raw);
    if (o && typeof o === "object" && o.lastSlotByChannel && typeof o.lastSlotByChannel === "object") {
      return { lastSlotByChannel: o.lastSlotByChannel };
    }
  } catch (e) {
    if (e.code !== "ENOENT") console.warn("[logo-archive] state read:", e.message);
  }
  return { lastSlotByChannel: {} };
}

async function saveScanState(doc) {
  await fs.mkdir(path.dirname(config.logoArchiveScan.stateFilePath), { recursive: true });
  const tmp = `${config.logoArchiveScan.stateFilePath}.tmp`;
  const out = {
    version: 1,
    savedAt: new Date().toISOString(),
    lastSlotByChannel: doc.lastSlotByChannel,
  };
  await fs.writeFile(tmp, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  await fs.rename(tmp, config.logoArchiveScan.stateFilePath);
}

function channelKey(tenantId, channelId) {
  return `${tenantId}::${channelId}`;
}

/**
 * @param {string} channelId
 * @param {string} tenantId
 * @param {string} hlsBaseUrl
 * @param {number} startEpoch
 * @param {number} endEpoch
 */
async function mergeArchiveAdSegment(channelId, tenantId, hlsBaseUrl, startEpoch, endEpoch) {
  const cur = await readChannelSnapshotById(channelId);
  const ads = Array.isArray(cur?.ads) ? [...cur.ads] : [];
  const dup = ads.some((a) => a.startEpoch === startEpoch && a.endEpoch === endEpoch);
  if (dup) return;
  ads.push({
    startEpoch,
    endEpoch,
    startProgramDateTime: "",
    endProgramDateTime: "",
  });
  ads.sort((a, b) => a.startEpoch - b.startEpoch);
  await mergeChannelSnapshotFields(channelId, {
    tenantId,
    hlsBaseUrl,
    ads,
  });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function runOneCycle() {
  if (!(await fileExists(config.logoDetector.bin))) {
    console.error(
      `[logo-archive] Skipping cycle: missing ${config.logoDetector.bin} (make -C utils/logo-detector)`,
    );
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const w = Math.max(30, config.logoArchiveScan.windowSeconds);
  const slotStart = Math.floor(nowSec / w) * w;
  const slotEnd = slotStart + w;

  const state = await loadScanState();
  const map = state.lastSlotByChannel;

  for (const tenantId of config.tenants) {
    let accountId;
    try {
      const t = await resolveTenant(tenantId);
      accountId = t.accountId;
    } catch (e) {
      console.error(`[logo-archive] tenant ${tenantId}: ${e.message}`);
      continue;
    }

    let rows;
    try {
      rows = await fetchChannelsWithArchive({ accountId, tenantId });
    } catch (e) {
      console.error(`[logo-archive] channels ${tenantId}: ${e.message}`);
      continue;
    }

    for (const row of rows) {
      const channelId = String(row._id);
      const hls = row.hlsStream || row.hlsMaster || "";
      if (!hls) continue;

      const paths = await resolveChannelLogoPathsForMatching(channelId);
      if (paths.length === 0) {
        continue;
      }

      const ck = channelKey(tenantId, channelId);
      if (map[ck] === slotStart) {
        continue;
      }

      const base = resolveHlsBaseUrl(hls);
      const timeoutMs = config.logoDetector.runTimeoutMs;
      const half = Math.floor(w / 2);

      /**
       * Single-frame probe per sub-window. Two half-slots avoid marking a full 2×half window as ad
       * when the break starts mid-window (previously up to ~w seconds late on start time).
       */
      async function probeWindow(a, b) {
        const m3u8 = buildArchiveM3u8(hls, a, b);
        const p = await runLogoDetectorOnStream(m3u8, paths, { timeoutMs });
        if (!p) return null;
        return p.logo === true || p.logo_present === true;
      }

      if (half >= 15 && slotStart + half < slotEnd) {
        const mid = slotStart + half;
        const [logoFirst, logoSecond] = await Promise.all([
          probeWindow(slotStart, mid),
          probeWindow(mid, slotEnd),
        ]);
        if (logoFirst === null || logoSecond === null) {
          console.warn(`[logo-archive] detector failed tenant=${tenantId} channel=${channelId} slot=${slotStart}`);
          continue;
        }
        if (!logoFirst && !logoSecond) {
          await mergeArchiveAdSegment(channelId, tenantId, base, slotStart, slotEnd);
          console.log(
            `[logo-archive] slot [${slotStart},${slotEnd}) no logo → ad tenant=${tenantId} channel=${channelId}`,
          );
        } else if (logoFirst && !logoSecond) {
          await mergeArchiveAdSegment(channelId, tenantId, base, mid, slotEnd);
          console.log(
            `[logo-archive] slot [${mid},${slotEnd}) no logo (mid break) tenant=${tenantId} channel=${channelId}`,
          );
        } else if (!logoFirst && logoSecond) {
          await mergeArchiveAdSegment(channelId, tenantId, base, slotStart, mid);
          console.log(
            `[logo-archive] slot [${slotStart},${mid}) no logo (early break) tenant=${tenantId} channel=${channelId}`,
          );
        }
      } else {
        const m3u8 = buildArchiveM3u8(hls, slotStart, slotEnd);
        const probe = await runLogoDetectorOnStream(m3u8, paths, { timeoutMs });
        if (!probe) {
          console.warn(`[logo-archive] detector failed tenant=${tenantId} channel=${channelId} slot=${slotStart}`);
          continue;
        }
        const logoPresent = probe.logo === true || probe.logo_present === true;
        if (!logoPresent) {
          await mergeArchiveAdSegment(channelId, tenantId, base, slotStart, slotEnd);
          console.log(
            `[logo-archive] slot [${slotStart},${slotEnd}) no logo match → ad segment ` +
              `tenant=${tenantId} channel=${channelId}`,
          );
        }
      }

      map[ck] = slotStart;
      await saveScanState({ lastSlotByChannel: map });
    }
  }
}

async function schedulerLoop() {
  while (schedulerRunning) {
    try {
      await runOneCycle();
    } catch (e) {
      console.error(`[logo-archive] cycle error: ${e.message}`);
    }
    if (!schedulerRunning) break;
    await sleep(Math.max(5000, config.logoArchiveScan.cyclePauseMs));
  }
}

/**
 * Starts the archive scan loop (idempotent). Uses logo-detector + uploaded logos only.
 */
export function startLogoScanScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  schedulerLoop().catch((e) => console.error("[logo-archive] fatal:", e));
}

export function stopLogoScanScheduler() {
  schedulerRunning = false;
}
