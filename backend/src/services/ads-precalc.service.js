/**
 * Timeline / editor ads from per-channel JSON under backend/data/channels/.
 */

import { config } from "../config.js";
import { readChannelSnapshotById, readChannelSnapshotByHls } from "./channel-ads-disk.service.js";

function findAdsInList(adsList, startEpoch, endEpoch) {
  return (adsList ?? []).filter((ad) => ad.endEpoch > startEpoch && ad.startEpoch < endEpoch);
}

function resolveBaseUrl(hlsStream) {
  const url = new URL(hlsStream);
  return `${url.origin}${url.pathname}`;
}

function filterAdsByRetention(adsList) {
  const cutoff = Math.floor(Date.now() / 1000) - config.adsRetentionHours * 3600;
  return (adsList ?? []).filter((ad) => ad.endEpoch > cutoff);
}

function toTimelineAds(adsList) {
  return (adsList ?? []).map((ad) => ({
    startEpoch: ad.startEpoch,
    endEpoch: ad.endEpoch,
    startProgramDateTime: ad.startProgramDateTime ?? "",
    endProgramDateTime: ad.endProgramDateTime ?? "",
  }));
}

function buildProcessedRange(processedEarliest, processedLatest) {
  if (processedEarliest === Infinity || processedLatest === -Infinity) return null;
  return {
    earliest: new Date(processedEarliest * 1000).toISOString(),
    latest: new Date(processedLatest * 1000).toISOString(),
  };
}

function findAdsForWindow(adsList, startEpoch, endEpoch) {
  const filtered = findAdsInList(adsList, startEpoch, endEpoch);
  const mapped = toTimelineAds(filtered);
  let procEarliest = Infinity;
  let procLatest = -Infinity;
  if (adsList.length > 0) {
    procEarliest = Math.min(...adsList.map((a) => a.startEpoch));
    procLatest = Math.max(...adsList.map((a) => a.endEpoch));
  }
  const processedRange = buildProcessedRange(procEarliest, procLatest);
  return { ads: mapped, processedRange };
}

/**
 * POST /api/ads/detect — offsets relative to clip window (from stored channel snapshot).
 */
export async function queryAdsByM3u8Url(m3u8Url) {
  try {
    const url = new URL(m3u8Url);
    const startTime = parseInt(url.searchParams.get("startTime"), 10);
    const endTime = parseInt(url.searchParams.get("endTime"), 10);
    if (!startTime || !endTime || endTime <= startTime) return null;

    const snap = await readChannelSnapshotByHls(m3u8Url);
    const adsList = snap?.ads ? filterAdsByRetention(snap.ads) : [];
    const { ads, processedRange } = findAdsForWindow(adsList, startTime, endTime);

    return {
      m3u8: m3u8Url,
      totalDurationSec: endTime - startTime,
      process: { elapsedMs: 0, elapsedSec: 0 },
      ads: ads.map((ad) => ({
        startOffsetSec: Math.max(0, ad.startEpoch - startTime),
        endOffsetSec: Math.min(endTime - startTime, ad.endEpoch - startTime),
        startOffsetHms: "",
        endOffsetHms: "",
        startProgramDateTime: ad.startProgramDateTime,
        endProgramDateTime: ad.endProgramDateTime,
      })),
      _processedRange: processedRange,
    };
  } catch {
    return null;
  }
}

/**
 * GET /api/ads/precalculated — vertical timeline.
 */
export async function queryAdsForTimeline(hlsStream, startEpoch, endEpoch, options = {}) {
  const baseUrl = resolveBaseUrl(hlsStream);
  const { channelId: queryChannelId } = options;

  let snap = null;
  if (queryChannelId) {
    snap = await readChannelSnapshotById(queryChannelId);
    if (snap?.hlsBaseUrl && snap.hlsBaseUrl !== baseUrl) snap = null;
  }
  if (!snap) snap = await readChannelSnapshotByHls(hlsStream);

  let adsList = snap?.ads ?? [];
  adsList = filterAdsByRetention(adsList);

  const { ads, processedRange } = findAdsForWindow(adsList, startEpoch, endEpoch);
  return { ads, processedRange };
}
