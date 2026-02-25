import { prewarmConfig } from "../cache_prewarm.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive } from "./channels.service.js";
import { detectAdsAsync } from "./ads.service.js";
import { registerChannel, appendDetectionResult, getStats } from "./ads-precalc.service.js";

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

const MAX_CONSECUTIVE_FAILURES = 3;

async function prewarmChannel(affiliate, channel, blockDurationSec, daysBack) {
  const hlsStream = channel.hlsStream;
  if (!hlsStream) {
    console.log(`[prewarm] Skipping channel "${channel.title}" — no hlsStream`);
    return 0;
  }

  console.log(`[prewarm] ──── Channel: "${channel.title}" (${channel._id}) ────`);

  const now = new Date();
  const daysBackMs = daysBack * 24 * 60 * 60 * 1000;

  const oldestDate = floorToHour(new Date(now.getTime() - daysBackMs));
  const newestDate = ceilToHour(now);

  const baseUrlStr = getBaseUrl(hlsStream);

  registerChannel(baseUrlStr);

  console.log(
    `[prewarm] Processing range: ${oldestDate.toISOString()} → ${newestDate.toISOString()} (oldest first)`
  );

  let current = new Date(oldestDate);
  let processedCount = 0;
  let totalAdsFound = 0;
  let consecutiveFailures = 0;
  let archiveStartFound = false;

  while (current < newestDate) {
    const startEpoch = Math.floor(current.getTime() / 1000);
    const endEpoch = startEpoch + blockDurationSec;
    const hourLabel = formatHour(current);

    const m3u8Url = `${baseUrlStr}?startTime=${startEpoch}&endTime=${endEpoch}`;

    console.log(
      `[prewarm] [${affiliate.tenantId}] [${channel.title}] Processing: ${hourLabel}`
    );

    try {
      const result = await detectAdsAsync({
        m3u8Url,
        corner: affiliate.corner || "br",
      });

      const adCount = result.ads?.length ?? 0;
      appendDetectionResult(baseUrlStr, startEpoch, endEpoch, result);
      totalAdsFound += adCount;
      consecutiveFailures = 0;
      archiveStartFound = true;

      console.log(
        `[prewarm] [${affiliate.tenantId}] [${channel.title}] ${hourLabel} → ${adCount} ad(s) detected`
      );
      processedCount++;
    } catch (err) {
      if (!archiveStartFound) {
        console.log(
          `[prewarm] [${affiliate.tenantId}] [${channel.title}] ${hourLabel} — no archive yet, skipping`
        );
      } else {
        consecutiveFailures++;
        console.error(
          `[prewarm] [${affiliate.tenantId}] [${channel.title}] ${hourLabel} — FAILED (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`
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
    `[prewarm] Channel "${channel.title}" done — ${processedCount} hours processed, ${totalAdsFound} ads found`
  );
  return processedCount;
}

export async function runPrewarm() {
  const { daysBack = 3, blockDurationMinutes = 60, affiliates = [] } = prewarmConfig;
  const blockDurationSec = blockDurationMinutes * 60;

  console.log("═══════════════════════════════════════════════════════");
  console.log("[prewarm] Starting ads pre-calculation…");
  console.log(`[prewarm] Config: daysBack=${daysBack}, blockDuration=${blockDurationMinutes}min, affiliates=${affiliates.length}`);
  console.log("═══════════════════════════════════════════════════════");

  const globalStart = Date.now();

  for (const affiliate of affiliates) {
    console.log(`\n[prewarm] ════ Affiliate: ${affiliate.tenantId} ════`);

    try {
      const { accountId } = await resolveTenant(affiliate.tenantId);

      console.log(
        `[prewarm] Affiliate "${affiliate.tenantId}" → accountId="${accountId}"`
      );

      const channels = await fetchChannelsWithArchive({ accountId, tenantId: affiliate.tenantId });

      console.log(
        `[prewarm] Found ${channels.length} channel(s) with archive for "${affiliate.tenantId}"`
      );

      for (const channel of channels) {
        await prewarmChannel(affiliate, channel, blockDurationSec, daysBack);
      }
    } catch (err) {
      console.error(
        `[prewarm] Failed to process affiliate "${affiliate.tenantId}": ${err.message}`
      );
    }
  }

  const elapsedSec = ((Date.now() - globalStart) / 1000).toFixed(1);
  const stats = getStats();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`[prewarm] Pre-calculation complete in ${elapsedSec}s`);
  console.log(`[prewarm] Total ads pre-calculated: ${stats.totalAds}`);
  for (const ch of stats.channels) {
    console.log(`[prewarm]   ${ch.baseUrl} — ${ch.adsCount} ads (${ch.earliest} → ${ch.latest})`);
  }
  console.log("═══════════════════════════════════════════════════════");
}
