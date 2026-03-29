/**
 * In-memory ads store keyed by HLS base URL (origin + path, no query).
 * Timeline reads from memory when hot; after restart, from per-channel JSON under backend/data/channels/.
 */

import { config } from "../config.js";
import {
  readChannelSnapshotById,
  readChannelSnapshotByHls,
  saveChannelProcessingSnapshot,
} from "./channel-ads-disk.service.js";
import { getFragmentsForChannel } from "./logo-scan-state.service.js";

// Map<baseHlsUrl, ChannelAds>
const store = new Map();

/**
 * Core query: ads overlapping [startEpoch, endEpoch).
 */
function findAdsInList(adsList, startEpoch, endEpoch) {
  return (adsList ?? []).filter((ad) => ad.endEpoch > startEpoch && ad.startEpoch < endEpoch);
}

function resolveBaseUrl(hlsStream) {
  const url = new URL(hlsStream);
  return `${url.origin}${url.pathname}`;
}

function filterAdsByRetention(adsList) {
  const cutoff = Math.floor(Date.now() / 1000) - config.logoScan.archiveHours * 3600;
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

/**
 * POST /api/ads/detect — editor timeline (offsets relative to clip window).
 */
export function queryAdsByM3u8Url(m3u8Url) {
  try {
    const url = new URL(m3u8Url);
    const startTime = parseInt(url.searchParams.get("startTime"), 10);
    const endTime = parseInt(url.searchParams.get("endTime"), 10);
    if (!startTime || !endTime || endTime <= startTime) return null;

    const baseUrl = resolveBaseUrl(m3u8Url);
    const channel = store.get(baseUrl);
    if (!channel) return null;

    const { ads, processedRange } = findAdsForChannelEntry(channel.ads ?? [], channel, startTime, endTime);

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

function findAdsForChannelEntry(adsList, channelMeta, startEpoch, endEpoch) {
  const filtered = findAdsInList(adsList, startEpoch, endEpoch);
  const mapped = toTimelineAds(filtered);
  const processedEarliest = channelMeta.processedEarliest ?? Infinity;
  const processedLatest = channelMeta.processedLatest ?? -Infinity;
  const processedRange = buildProcessedRange(processedEarliest, processedLatest);
  return { ads: mapped, processedRange };
}

/**
 * GET /api/ads/precalculated — vertical timeline (disk + in-memory).
 * @param {string} hlsStream
 * @param {number} startEpoch
 * @param {number} endEpoch
 * @param {{ channelId?: string }} [options]
 */
export async function queryAdsForTimeline(hlsStream, startEpoch, endEpoch, options = {}) {
  const baseUrl = resolveBaseUrl(hlsStream);
  const { channelId: queryChannelId } = options;

  let adsList = null;

  if (store.has(baseUrl)) {
    adsList = store.get(baseUrl).ads ?? [];
  } else {
    let snap = null;
    if (queryChannelId) {
      snap = await readChannelSnapshotById(queryChannelId);
      if (snap?.hlsBaseUrl && snap.hlsBaseUrl !== baseUrl) {
        snap = null;
      }
    }
    if (!snap) snap = await readChannelSnapshotByHls(hlsStream);
    if (snap?.ads) adsList = snap.ads;
  }

  if (!adsList) {
    return { ads: [], processedRange: null };
  }

  adsList = filterAdsByRetention(adsList);

  let procEarliest = Infinity;
  let procLatest = -Infinity;
  if (adsList.length > 0) {
    procEarliest = Math.min(...adsList.map((a) => a.startEpoch));
    procLatest = Math.max(...adsList.map((a) => a.endEpoch));
  }

  const filtered = findAdsInList(adsList, startEpoch, endEpoch);
  const ads = toTimelineAds(filtered);
  const processedRange = buildProcessedRange(procEarliest, procLatest);

  return { ads, processedRange };
}

/**
 * Replace ads overlapping [windowStartEpoch, windowEndEpoch) and merge new segments (absolute unix seconds).
 * @param {string} hlsStream channel base URL (used only to compute store key)
 * @param {number} windowStartEpoch inclusive
 * @param {number} windowEndEpoch exclusive
 * @param {Array<{ startEpoch: number, endEpoch: number, startProgramDateTime?: string, endProgramDateTime?: string }>} segments
 * @param {{ channelId?: string, tenantId?: string }} [meta]
 * @returns {{ ads: object[], processedEarliest: number, processedLatest: number }}
 */
export function ingestMatcherAds(hlsStream, windowStartEpoch, windowEndEpoch, segments, meta = {}) {
  const baseUrl = resolveBaseUrl(hlsStream);
  let channel = store.get(baseUrl);
  if (!channel) {
    channel = { ads: [], processedEarliest: Infinity, processedLatest: -Infinity };
    store.set(baseUrl, channel);
  }
  const segmentsNorm = segments.map((s) => ({
    startEpoch: s.startEpoch,
    endEpoch: s.endEpoch,
    startProgramDateTime: s.startProgramDateTime ?? "",
    endProgramDateTime: s.endProgramDateTime ?? "",
  }));
  const ads = channel.ads ?? [];
  const filtered = ads.filter((ad) => !(ad.endEpoch > windowStartEpoch && ad.startEpoch < windowEndEpoch));
  const merged = [...filtered, ...segmentsNorm].sort((a, b) => a.startEpoch - b.startEpoch);
  channel.ads = merged;
  if (meta?.channelId != null) channel.channelId = meta.channelId;
  if (meta?.tenantId != null) channel.tenantId = meta.tenantId;
  if (merged.length === 0) {
    channel.processedEarliest = Infinity;
    channel.processedLatest = -Infinity;
  } else {
    channel.processedEarliest = Math.min(...merged.map((a) => a.startEpoch));
    channel.processedLatest = Math.max(...merged.map((a) => a.endEpoch));
  }
  return {
    ads: merged,
    processedEarliest: channel.processedEarliest,
    processedLatest: channel.processedLatest,
  };
}

/**
 * Remove ad windows entirely before cutoff (exclusive end <= cutoff); refresh per-channel JSON on disk.
 * @param {number} cutoffEpoch
 */
export async function pruneAdsOlderThan(cutoffEpoch) {
  for (const channel of store.values()) {
    if (!channel.ads?.length) continue;
    channel.ads = channel.ads.filter((ad) => ad.endEpoch > cutoffEpoch);
    if (channel.ads.length === 0) {
      channel.processedEarliest = Infinity;
      channel.processedLatest = -Infinity;
    } else {
      channel.processedEarliest = Math.min(...channel.ads.map((a) => a.startEpoch));
      channel.processedLatest = Math.max(...channel.ads.map((a) => a.endEpoch));
    }
  }

  for (const [baseUrl, ch] of store.entries()) {
    if (!ch.channelId) continue;
    const fragments = ch.tenantId ? getFragmentsForChannel(ch.tenantId, ch.channelId) : [];
    await saveChannelProcessingSnapshot({
      tenantId: ch.tenantId ?? "",
      channelId: ch.channelId,
      hlsBaseUrl: baseUrl,
      ads: ch.ads ?? [],
      processedEarliest: ch.processedEarliest ?? Infinity,
      processedLatest: ch.processedLatest ?? -Infinity,
      fragments,
    });
  }
}
