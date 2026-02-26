/**
 * Pre-calculated ads store.
 *
 * The prewarm process runs the detector hour-by-hour and appends each
 * detected ad interval (absolute start/end timestamps) into a flat
 * sorted list per channel.  The editor timeline then queries this
 * in-memory data instantly, with no on-demand detection.
 */

// Map<baseHlsUrl, ChannelAds>
const store = new Map();

export function registerChannel(baseUrl) {
  if (!store.has(baseUrl)) {
    store.set(baseUrl, {
      processedEarliest: Infinity,
      processedLatest: -Infinity,
      ads: [],
    });
  }
}

export function getProcessedLatest(baseUrl) {
  const channel = store.get(baseUrl);
  if (!channel || channel.processedLatest === -Infinity) return null;
  return channel.processedLatest;
}

export function appendDetectionResult(baseUrl, blockStartEpoch, blockEndEpoch, detectionResult) {
  const channel = store.get(baseUrl);
  if (!channel) return;

  if (blockStartEpoch < channel.processedEarliest) channel.processedEarliest = blockStartEpoch;
  if (blockEndEpoch > channel.processedLatest) channel.processedLatest = blockEndEpoch;

  for (const ad of detectionResult.ads || []) {
    const startEpoch = Math.floor(new Date(ad.startProgramDateTime).getTime() / 1000);
    const endEpoch = Math.floor(new Date(ad.endProgramDateTime).getTime() / 1000);

    const duplicate = channel.ads.some(
      (a) => a.startEpoch === startEpoch && a.endEpoch === endEpoch
    );
    if (duplicate) continue;

    channel.ads.push({
      startEpoch,
      endEpoch,
      startProgramDateTime: ad.startProgramDateTime,
      endProgramDateTime: ad.endProgramDateTime,
    });
  }

  channel.ads.sort((a, b) => a.startEpoch - b.startEpoch);
}

/**
 * Core query: returns all pre-calculated ads overlapping with [startEpoch, endEpoch),
 * regardless of whether the range is fully covered by processed data.
 */
function findAds(baseUrl, startEpoch, endEpoch) {
  const channel = store.get(baseUrl);
  if (!channel) return { ads: [], processedRange: null };

  const ads = channel.ads.filter(
    (ad) => ad.endEpoch > startEpoch && ad.startEpoch < endEpoch
  );

  const processedRange =
    channel.processedEarliest !== Infinity
      ? {
          earliest: new Date(channel.processedEarliest * 1000).toISOString(),
          latest: new Date(channel.processedLatest * 1000).toISOString(),
        }
      : null;

  return { ads, processedRange };
}

function resolveBaseUrl(hlsStream) {
  const url = new URL(hlsStream);
  return `${url.origin}${url.pathname}`;
}

/**
 * Used by POST /api/ads/detect (editor timeline).
 * Returns ads formatted with fields the editor expects.
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
      ads: ads.map((ad) => ({
        startOffsetSec: Math.max(0, ad.startEpoch - startTime),
        endOffsetSec: Math.min(endTime - startTime, ad.endEpoch - startTime),
        startProgramDateTime: ad.startProgramDateTime,
        endProgramDateTime: ad.endProgramDateTime,
      })),
      _fromPreCalc: true,
      _processedRange: processedRange,
    };
  } catch {
    return null;
  }
}

/**
 * Used by GET /api/ads/precalculated (EPG timeline yellow blocks).
 */
export function queryAdsForTimeline(hlsStream, startEpoch, endEpoch) {
  const baseUrl = resolveBaseUrl(hlsStream);
  return findAds(baseUrl, startEpoch, endEpoch);
}

export function getStats() {
  const summary = [];
  for (const [baseUrl, ch] of store) {
    if (ch.processedEarliest === Infinity) continue;
    summary.push({
      baseUrl,
      adsCount: ch.ads.length,
      earliest: new Date(ch.processedEarliest * 1000).toISOString(),
      latest: new Date(ch.processedLatest * 1000).toISOString(),
    });
  }
  return { channels: summary, totalAds: summary.reduce((s, c) => s + c.adsCount, 0) };
}
