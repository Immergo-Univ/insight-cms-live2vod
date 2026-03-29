/**
 * Single-threaded in-memory scheduler: one tenant → one archive channel at a time.
 * Uses config.tenants, logo CLIs, logo-scan-state (with JSON persistence), and ads-precalc ingestion.
 */

import { config } from "../config.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive } from "./channels.service.js";
import {
  loadFromDisk,
  isMatcherSlotProcessed,
  markMatcherSlotProcessed,
  recordMatcherSlotFragments,
  isBackfillComplete,
  setBackfillComplete,
  pruneFragmentsOlderThan,
  persistToDisk,
  getStateSummary,
  isDetectorCacheFresh,
  markDetectorSuccessful,
  getDetectorCacheExpiryIso,
  getFragmentsForChannel,
} from "./logo-scan-state.service.js";
import { ingestMatcherAds, pruneAdsOlderThan } from "./ads-precalc.service.js";
import { saveChannelProcessingSnapshot, resolveHlsBaseUrl } from "./channel-ads-disk.service.js";
import { matcherSegmentsToIngestAds } from "./matcher-time-map.service.js";
import {
  runLogoDetector,
  runTemplateMatcher,
  buildArchiveM3u8,
  buildDetectorArchiveM3u8,
  hasDetectorArtifacts,
} from "./logo-pipeline.service.js";

let schedulerRunning = false;
let runPromise = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function retentionCutoff(nowSec) {
  return nowSec - config.logoScan.archiveHours * 3600;
}

/** Earliest matcher slot start (inclusive) to walk: within retention and within matcherArchiveHours. */
function matcherScanCutoffEpoch(nowSec) {
  const retention = retentionCutoff(nowSec);
  const archiveCap = nowSec - config.logoScan.matcherArchiveHours * 3600;
  return Math.max(retention, archiveCap);
}

function matcherWindowSec() {
  return config.logoScan.matcherWindowSeconds;
}

/**
 * After each matcher slot: merge ads, write channel JSON for the timeline, persist scan state immediately.
 * `slotStart` / window end are the same values passed as URL `startTime` / `endTime` to streamPlaylist.
 */
async function applyMatcherSlotResults(tenantId, channelId, hlsBase, slotStart, result) {
  const playlistStartTimeEpoch = slotStart;
  const playlistEndTimeEpoch = slotStart + matcherWindowSec();
  const adSegments = result.ad_segments || [];
  const timeMapOpts = {
    mediaTimelineZeroEpochUtc: result.mediaTimelineZeroEpochUtc,
  };
  recordMatcherSlotFragments(
    tenantId,
    channelId,
    playlistStartTimeEpoch,
    playlistEndTimeEpoch,
    adSegments,
    timeMapOpts,
  );
  const abs = matcherSegmentsToIngestAds(
    playlistStartTimeEpoch,
    playlistEndTimeEpoch,
    adSegments,
    timeMapOpts,
  );
  const snap = ingestMatcherAds(
    hlsBase,
    playlistStartTimeEpoch,
    playlistEndTimeEpoch,
    abs,
    { channelId, tenantId },
  );
  await saveChannelProcessingSnapshot({
    tenantId,
    channelId,
    hlsBaseUrl: resolveHlsBaseUrl(hlsBase),
    ads: snap.ads,
    processedEarliest: snap.processedEarliest,
    processedLatest: snap.processedLatest,
    fragments: getFragmentsForChannel(tenantId, channelId),
  });
  markMatcherSlotProcessed(tenantId, channelId, slotStart);
  await persistToDisk();
}

/**
 * Refresh only the current matcher window slot (detector still uses multi-hour UTC archive).
 */
async function refreshLatestMatcherSlot(tenantId, channelId, hlsBase, latestHourStart, latestSlotStart) {
  const hourSec = config.logoScan.hourSeconds;
  const slotSec = matcherWindowSec();
  const detHours = config.logoScan.detectorArchiveHours;
  const detStart = latestHourStart - (detHours - 1) * hourSec;
  console.log(
    `[logo-scan] ── Channel refresh tenant=${tenantId} channel=${channelId} ` +
      `matcher_UTC=[${latestSlotStart}, ${latestSlotStart + slotSec}) ` +
      `detector_UTC=[${detStart}, ${latestHourStart + hourSec}) (${detHours}h)`,
  );
  const detectorUrl = buildDetectorArchiveM3u8(hlsBase, latestHourStart);
  if (!(await ensureDetectorForChannel(tenantId, channelId, detectorUrl))) {
    console.log(`[logo-scan] refresh aborted (detector not available) ${tenantId}/${channelId}`);
    return;
  }
  const matchUrl = buildArchiveM3u8(hlsBase, latestSlotStart, latestSlotStart + slotSec);
  const result = await runTemplateMatcher(matchUrl, channelId, {
    tenantId,
    slotStartEpoch: latestSlotStart,
    label: "refresh",
  });
  if (!result) {
    console.log(`[logo-scan] refresh aborted (matcher failed) ${tenantId}/${channelId}`);
    return;
  }
  console.log(`[logo-scan] STAGE ingest START tenant=${tenantId} channel=${channelId} slot=${latestSlotStart}`);
  await applyMatcherSlotResults(tenantId, channelId, hlsBase, latestSlotStart, result);
  console.log(
    `[logo-scan] STAGE ingest DONE refresh tenant=${tenantId} channel=${channelId} ` +
      `ads_segments=${adSegmentsCount(result)} scanned_s=${result.scanned_duration_seconds}`,
  );
}

function adSegmentsCount(result) {
  return result.ad_segments?.length ?? 0;
}

/**
 * Runs logo-detector only if JSON/JPG missing or cache older than 24h (configurable).
 */
async function ensureDetectorForChannel(tenantId, channelId, detectorUrl) {
  const artifacts = await hasDetectorArtifacts(channelId);
  const fresh = isDetectorCacheFresh(tenantId, channelId);
  if (artifacts && fresh) {
    const until = getDetectorCacheExpiryIso(tenantId, channelId);
    console.log(
      `[logo-scan] STAGE logo-detector SKIP — reusing bbox+template on disk (valid until ${until}) ` +
        `tenant=${tenantId} channel=${channelId}`,
    );
    return true;
  }
  if (!artifacts && fresh) {
    console.log(
      `[logo-scan] STAGE logo-detector RUN — detector files missing, ignoring stale cache entry ` +
        `tenant=${tenantId} channel=${channelId}`,
    );
  } else if (artifacts && !fresh) {
    console.log(
      `[logo-scan] STAGE logo-detector RUN — cache expired (>${config.logoScan.detectorCacheTtlMs / 3600000}h) ` +
        `tenant=${tenantId} channel=${channelId}`,
    );
  } else {
    console.log(
      `[logo-scan] STAGE logo-detector RUN — no prior successful detector in cache ` +
        `tenant=${tenantId} channel=${channelId}`,
    );
  }
  const ok = await runLogoDetector(detectorUrl, channelId);
  if (ok) markDetectorSuccessful(tenantId, channelId);
  return ok;
}

async function backfillChannel(tenantId, channelId, hlsBase, latestHourStart, latestSlotStart, nowSec) {
  const hourSec = config.logoScan.hourSeconds;
  const slotSec = matcherWindowSec();
  const detHours = config.logoScan.detectorArchiveHours;
  const detStart = latestHourStart - (detHours - 1) * hourSec;
  const detectorUrl = buildDetectorArchiveM3u8(hlsBase, latestHourStart);
  console.log(
    `[logo-scan] ── Channel backfill START tenant=${tenantId} channel=${channelId} ` +
      `detector_window_UTC=[${detStart}, ${latestHourStart + hourSec}) (${detHours}h) ` +
      `matcher_slot_sec=${slotSec}`,
  );
  if (!(await ensureDetectorForChannel(tenantId, channelId, detectorUrl))) {
    console.log(`[logo-scan] backfill deferred (detector not available), retry later ${tenantId}/${channelId}`);
    return;
  }

  const scanCutoff = matcherScanCutoffEpoch(nowSec);
  const maxRuns = config.logoScan.matcherMaxRunsPerChannelPerCycle;
  let matcherFailed = false;
  let stoppedByBudget = false;
  let runsExecuted = 0;

  console.log(
    `[logo-scan] backfill scan window oldest_slot_UTC>=${scanCutoff} ` +
      `(matcherArchiveHours=${config.logoScan.matcherArchiveHours} retentionCutoff=${retentionCutoff(nowSec)}) ` +
      `maxRunsPerCycle=${maxRuns || "∞"}`,
  );

  for (let s = latestSlotStart; s >= scanCutoff; s -= slotSec) {
    if (isMatcherSlotProcessed(tenantId, channelId, s)) {
      console.log(
        `[logo-scan] STAGE template-matching SKIP (slot already processed) ` +
          `tenant=${tenantId} channel=${channelId} slotUTC=[${s}, ${s + slotSec})`,
      );
      continue;
    }
    if (maxRuns > 0 && runsExecuted >= maxRuns) {
      stoppedByBudget = true;
      console.log(
        `[logo-scan] backfill paused (matcherMaxRunsPerChannelPerCycle=${maxRuns}) ` +
          `tenant=${tenantId} channel=${channelId} — will resume next cycle`,
      );
      break;
    }
    const url = buildArchiveM3u8(hlsBase, s, s + slotSec);
    console.log(
      `[logo-scan] STAGE queue template-matching newest→oldest ` +
        `tenant=${tenantId} channel=${channelId} next_slotUTC=[${s}, ${s + slotSec})`,
    );
    const result = await runTemplateMatcher(url, channelId, {
      tenantId,
      slotStartEpoch: s,
      label: "backfill",
    });
    if (!result) {
      matcherFailed = true;
      console.log(
        `[logo-scan] backfill chain stopped at slot=${s} (playlist or tool error) ` +
          `tenant=${tenantId} channel=${channelId}`,
      );
      break;
    }
    console.log(`[logo-scan] STAGE ingest START tenant=${tenantId} channel=${channelId} slot=${s}`);
    await applyMatcherSlotResults(tenantId, channelId, hlsBase, s, result);
    runsExecuted++;
    console.log(
      `[logo-scan] STAGE ingest DONE tenant=${tenantId} channel=${channelId} slot=${s} ` +
        `ads_segments=${adSegmentsCount(result)} scanned_s=${result.scanned_duration_seconds}`,
    );
  }

  if (!matcherFailed && !stoppedByBudget) {
    setBackfillComplete(tenantId, channelId, true);
    console.log(`[logo-scan] backfill marked COMPLETE ${tenantId}/${channelId}`);
  } else if (matcherFailed) {
    console.log(
      `[logo-scan] backfill stays INCOMPLETE (matcher error) ${tenantId}/${channelId} — fix CDN/window or retry`,
    );
  } else {
    console.log(
      `[logo-scan] backfill INCOMPLETE (run budget) ${tenantId}/${channelId} — more slots next cycle`,
    );
  }
}

async function runOneCycle() {
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = retentionCutoff(nowSec);
  pruneFragmentsOlderThan(cutoff);
  await pruneAdsOlderThan(cutoff);

  const latestHourStart = Math.floor(nowSec / config.logoScan.hourSeconds) * config.logoScan.hourSeconds;
  const slotSec = matcherWindowSec();
  const latestSlotStart = Math.floor(nowSec / slotSec) * slotSec;
  const tenants = config.tenants;

  console.log(
    `[logo-scan] —— cycle start ${new Date().toISOString()} latestHourUTC=${latestHourStart} ` +
      `latestMatcherSlotUTC=${latestSlotStart} matcherWindowSec=${slotSec} ` +
      `retentionCutoff=${cutoff} summary=${JSON.stringify(getStateSummary())}`,
  );

  for (const tenantId of tenants) {
    console.log(`[logo-scan] STAGE tenant START tenant=${tenantId} (resolve + list archive channels)`);
    const { accountId } = await resolveTenant(tenantId);
    const rawChannels = await fetchChannelsWithArchive({ accountId, tenantId });
    console.log(`[logo-scan] STAGE tenant channels loaded tenant=${tenantId} count=${rawChannels.length}`);

    for (let i = 0; i < rawChannels.length; i++) {
      const ch = rawChannels[i];
      const channelId = String(ch._id);
      const title = ch.title || "";
      const hlsBase = ch.hlsStream || ch.hlsMaster;
      if (!hlsBase) {
        console.log(`[logo-scan] STAGE channel SKIP ${i + 1}/${rawChannels.length} id=${channelId} (no HLS URL)`);
        continue;
      }

      const bfDone = isBackfillComplete(tenantId, channelId);
      console.log(
        `[logo-scan] STAGE channel ${i + 1}/${rawChannels.length} id=${channelId} title="${title}" ` +
          `backfillComplete=${bfDone}` +
          (bfDone ? " (this pass: latest archive window only)" : ""),
      );
      if (bfDone) {
        await refreshLatestMatcherSlot(tenantId, channelId, hlsBase, latestHourStart, latestSlotStart);
      } else {
        await backfillChannel(tenantId, channelId, hlsBase, latestHourStart, latestSlotStart, nowSec);
      }
      console.log(`[logo-scan] STAGE channel END ${i + 1}/${rawChannels.length} id=${channelId}`);
    }
    console.log(`[logo-scan] STAGE tenant END tenant=${tenantId}`);
  }

  await persistToDisk();
  console.log(`[logo-scan] —— cycle end persisted state`);
}

async function schedulerLoop() {
  while (schedulerRunning) {
    try {
      await runOneCycle();
    } catch (e) {
      console.error(`[logo-scan] cycle error: ${e.message}`);
    }
    if (!schedulerRunning) break;
    console.log(`[logo-scan] sleeping ${config.logoScan.cyclePauseMs}ms before next cycle`);
    await sleep(config.logoScan.cyclePauseMs);
  }
}

/**
 * Starts the loop (idempotent). Requires LOGO_SCAN_ENABLED=true and Insight credentials for tenants.
 */
export function startLogoScanScheduler() {
  if (!config.logoScan.enabled) {
    console.log("[logo-scan] Scheduler disabled (set LOGO_SCAN_ENABLED=true to enable)");
    return;
  }
  if (schedulerRunning) return;
  schedulerRunning = true;
  runPromise = (async () => {
    await loadFromDisk();
    console.log(
      `[logo-scan] Scheduler started — tenants=${JSON.stringify(config.tenants)} ` +
        `archiveHours=${config.logoScan.archiveHours} matcherArchiveHours=${config.logoScan.matcherArchiveHours} ` +
        `matcherWindowSec=${config.logoScan.matcherWindowSeconds} ` +
        `matcherMaxRunsPerChannelPerCycle=${config.logoScan.matcherMaxRunsPerChannelPerCycle || "∞"} ` +
        `fragmentSec=${config.logoScan.fragmentSeconds}`,
    );
    await schedulerLoop();
  })();
  runPromise.catch((e) => console.error("[logo-scan] scheduler fatal:", e));
}

export function stopLogoScanScheduler() {
  schedulerRunning = false;
}
