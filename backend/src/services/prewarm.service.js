import { prewarmConfig } from "../cache_prewarm.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive } from "./channels.service.js";
import { detectAdsAsync } from "./ads.service.js";
import {
  registerChannel,
  appendDetectionResult,
  getProcessedLatest,
  getStats,
} from "./ads-precalc.service.js";

function floorToHour(date) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

function ceilToHour(date) {
  const d = new Date(date);
  if (d.getMinutes() || d.getSeconds() || d.getMilliseconds()) {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return d;
}

function formatHour(date) {
  return date.toISOString().slice(0, 13) + ":00Z";
}

function getBaseUrl(hlsStream) {
  const url = new URL(hlsStream);
  return `${url.origin}${url.pathname}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_CONSECUTIVE_FAILURES = 3;

async function processChannel(affiliate, channel, blockDurationSec, startDate, endDate) {
  const hlsStream = channel.hlsStream;
  if (!hlsStream) {
    console.log(`[prewarm] [${affiliate.tenantId}] [${channel.title}] No hlsStream — skipping channel`);
    return 0;
  }

  const baseUrlStr = getBaseUrl(hlsStream);
  registerChannel(baseUrlStr);

  const totalHours = Math.ceil((endDate.getTime() - startDate.getTime()) / (blockDurationSec * 1000));
  console.log(
    `[prewarm] [${affiliate.tenantId}] [${channel.title}] ` +
    `Processing ${totalHours} hours: ${formatHour(startDate)} → ${formatHour(endDate)}`
  );
  console.log(`[prewarm] [${affiliate.tenantId}] [${channel.title}] Base URL: ${baseUrlStr}`);

  let current = new Date(startDate);
  let processedCount = 0;
  let totalAdsFound = 0;
  let consecutiveFailures = 0;
  let noArchiveSkips = 0;
  let archiveStartFound = !!getProcessedLatest(baseUrlStr);

  while (current < endDate) {
    const startEpoch = Math.floor(current.getTime() / 1000);
    const endEpoch = startEpoch + blockDurationSec;
    const hourLabel = formatHour(current);
    const hourIdx = processedCount + noArchiveSkips + consecutiveFailures + 1;

    const m3u8Url = `${baseUrlStr}?startTime=${startEpoch}&endTime=${endEpoch}`;

    console.log(
      `[prewarm] [${affiliate.tenantId}] [${channel.title}] [${hourIdx}/${totalHours}] ${hourLabel} — detecting…`
    );

    const t0 = Date.now();

    try {
      const result = await detectAdsAsync({
        m3u8Url,
        corner: affiliate.corner || "br",
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const adCount = result.ads?.length ?? 0;
      appendDetectionResult(baseUrlStr, startEpoch, endEpoch, result);
      totalAdsFound += adCount;
      consecutiveFailures = 0;
      noArchiveSkips = 0;
      archiveStartFound = true;

      console.log(
        `[prewarm] [${affiliate.tenantId}] [${channel.title}] [${hourIdx}/${totalHours}] ${hourLabel} → ${adCount} ad(s) detected (${elapsed}s)`
      );
      processedCount++;
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      if (!archiveStartFound) {
        noArchiveSkips++;
        console.log(
          `[prewarm] [${affiliate.tenantId}] [${channel.title}] [${hourIdx}/${totalHours}] ${hourLabel} — no archive (${elapsed}s)`
        );
      } else {
        consecutiveFailures++;
        console.error(
          `[prewarm] [${affiliate.tenantId}] [${channel.title}] [${hourIdx}/${totalHours}] ${hourLabel} — FAILED (${elapsed}s, ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`
        );

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.log(
            `[prewarm] [${affiliate.tenantId}] [${channel.title}] Too many failures after archive start — stopping`
          );
          break;
        }
      }
    }

    current = new Date(current.getTime() + blockDurationSec * 1000);
  }

  console.log(
    `[prewarm] [${affiliate.tenantId}] [${channel.title}] Done — ${processedCount} hours processed, ${totalAdsFound} ads found, ${noArchiveSkips} skipped`
  );
  return processedCount;
}

async function runPass(affiliates, blockDurationSec, daysBack) {
  const now = new Date();
  const daysBackMs = daysBack * 24 * 60 * 60 * 1000;
  const globalOldest = floorToHour(new Date(now.getTime() - daysBackMs));
  const globalNewest = ceilToHour(now);

  let totalProcessed = 0;

  for (const affiliate of affiliates) {
    console.log(`[prewarm] ════ Affiliate: ${affiliate.tenantId} ════`);

    try {
      const { accountId } = await resolveTenant(affiliate.tenantId);

      console.log(`[prewarm] accountId="${accountId}"`);

      const channels = await fetchChannelsWithArchive({ accountId, tenantId: affiliate.tenantId });

      console.log(`[prewarm] ${channels.length} channel(s) with archive`);

      for (const channel of channels) {
        if (!channel.hlsStream) continue;

        const baseUrlStr = getBaseUrl(channel.hlsStream);
        const lastProcessed = getProcessedLatest(baseUrlStr);

        const startDate = lastProcessed
          ? new Date(lastProcessed * 1000)
          : globalOldest;

        if (startDate >= globalNewest) {
          console.log(
            `[prewarm] [${affiliate.tenantId}] [${channel.title}] Already up to date — nothing to process`
          );
          continue;
        }

        totalProcessed += await processChannel(
          affiliate, channel, blockDurationSec, startDate, globalNewest
        );
      }
    } catch (err) {
      console.error(
        `[prewarm] Failed to process affiliate "${affiliate.tenantId}": ${err.message}`
      );
    }
  }

  return totalProcessed;
}

export async function runPrewarm() {
  const { daysBack = 3, blockDurationMinutes = 60, affiliates = [] } = prewarmConfig;
  const blockDurationSec = blockDurationMinutes * 60;

  console.log("═══════════════════════════════════════════════════════");
  console.log("[prewarm] Starting continuous ads pre-calculation…");
  console.log(`[prewarm] Config: daysBack=${daysBack}, blockDuration=${blockDurationMinutes}min, affiliates=${affiliates.length}`);
  console.log("═══════════════════════════════════════════════════════");

  let passNumber = 0;

  while (true) {
    passNumber++;
    const passStart = Date.now();

    console.log(`\n[prewarm] ── Pass #${passNumber} starting ──`);

    const processed = await runPass(affiliates, blockDurationSec, daysBack);

    const elapsedSec = ((Date.now() - passStart) / 1000).toFixed(1);
    const stats = getStats();

    console.log(`[prewarm] ── Pass #${passNumber} done in ${elapsedSec}s — ${processed} new hours ──`);
    console.log(`[prewarm] Store: ${stats.totalAds} ads total`);
    for (const ch of stats.channels) {
      console.log(`[prewarm]   ${ch.baseUrl} — ${ch.adsCount} ads (${ch.earliest} → ${ch.latest})`);
    }

    if (processed === 0) {
      const waitMin = blockDurationMinutes;
      console.log(`[prewarm] Nothing new — waiting ${waitMin}min…`);
      await sleep(waitMin * 60 * 1000);
    } else {
      console.log(`[prewarm] Checking for more…`);
      await sleep(5_000);
    }
  }
}
