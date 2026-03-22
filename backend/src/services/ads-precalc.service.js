/**
 * In-memory ads store keyed by HLS base URL (origin + path, no query).
 * Populated in the future via ingestion (API, external job, etc.).
 * GET/POST ads routes read from this store only.
 */

// Map<baseHlsUrl, ChannelAds>
const store = new Map();

/**
 * Core query: ads overlapping [startEpoch, endEpoch).
 */
function findAds(baseUrl, startEpoch, endEpoch) {
  const channel = store.get(baseUrl);
  if (!channel) return { ads: [], processedRange: null };

  const ads = (channel.ads ?? []).filter((ad) => ad.endEpoch > startEpoch && ad.startEpoch < endEpoch);

  const processedEarliest = channel.processedEarliest ?? Infinity;
  const processedLatest = channel.processedLatest ?? -Infinity;
  const processedRange =
    processedEarliest !== Infinity
      ? {
          earliest: new Date(processedEarliest * 1000).toISOString(),
          latest: new Date(processedLatest * 1000).toISOString(),
        }
      : null;

  return { ads, processedRange };
}

function resolveBaseUrl(hlsStream) {
  const url = new URL(hlsStream);
  return `${url.origin}${url.pathname}`;
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
    const { ads, processedRange } = findAds(baseUrl, startTime, endTime);

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
 * GET /api/ads/precalculated — EPG timeline blocks.
 */
export function queryAdsForTimeline(hlsStream, startEpoch, endEpoch) {
  const baseUrl = resolveBaseUrl(hlsStream);
  return findAds(baseUrl, startEpoch, endEpoch);
}
