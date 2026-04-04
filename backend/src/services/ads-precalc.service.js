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

/**
 * Half-open ad windows [startEpoch, endEpoch). Combine overlapping or boundary-adjacent intervals.
 * When one window is fully inside the other (e.g. live segment inside coarse archive slot), keep the
 * outer start and the inner end — same idea as using the first-absent instant for start: do not extend
 * end to the coarse slot boundary when live already closed the break earlier.
 * @param {{ startEpoch: number, endEpoch: number }} a
 * @param {{ startEpoch: number, endEpoch: number }} b
 * @returns {{ startEpoch: number, endEpoch: number } | null}
 */
function mergeOverlappingAdWindow(a, b) {
  const s1 = a.startEpoch;
  const e1 = a.endEpoch;
  const s2 = b.startEpoch;
  const e2 = b.endEpoch;

  const strictOverlap = Math.max(s1, s2) < Math.min(e1, e2);
  const adjacent = s2 === e1 || s1 === e2;
  if (!strictOverlap && !adjacent) return null;

  if (adjacent && !strictOverlap) {
    return { startEpoch: Math.min(s1, s2), endEpoch: Math.max(e1, e2) };
  }

  const bInsideA = s2 >= s1 && e2 <= e1;
  const aInsideB = s1 >= s2 && e1 <= e2;
  if (bInsideA) {
    return { startEpoch: s1, endEpoch: e2 };
  }
  if (aInsideB) {
    return { startEpoch: s2, endEpoch: e1 };
  }

  return { startEpoch: Math.min(s1, s2), endEpoch: Math.max(e1, e2) };
}

/**
 * Merge archive `ads` with live `liveStreamAdSegments` (same unix epoch axis as m3u8 startTime/endTime).
 */
function mergedAdsFromSnapshot(snap) {
  const archive = Array.isArray(snap?.ads) ? snap.ads : [];
  const liveRaw = Array.isArray(snap?.liveStreamAdSegments) ? snap.liveStreamAdSegments : [];
  const live = liveRaw.map((s) => ({
    startEpoch: s.startEpoch,
    endEpoch: s.endEpoch,
    startProgramDateTime: "",
    endProgramDateTime: "",
  }));
  const all = [...archive, ...live]
    .filter((a) => a && typeof a.startEpoch === "number" && typeof a.endEpoch === "number")
    .sort((a, b) => a.startEpoch - b.startEpoch || a.endEpoch - b.endEpoch);
  if (all.length === 0) return [];
  const out = [];
  let cur = { ...all[0] };
  for (let i = 1; i < all.length; i++) {
    const n = all[i];
    const merged = mergeOverlappingAdWindow(cur, n);
    if (merged) {
      cur = {
        ...cur,
        startEpoch: merged.startEpoch,
        endEpoch: merged.endEpoch,
      };
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
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
    const adsList = snap ? filterAdsByRetention(mergedAdsFromSnapshot(snap)) : [];
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

  let adsList = snap ? mergedAdsFromSnapshot(snap) : [];
  adsList = filterAdsByRetention(adsList);

  const { ads, processedRange } = findAdsForWindow(adsList, startEpoch, endEpoch);
  return { ads, processedRange };
}
