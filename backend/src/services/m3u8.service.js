import axios from "axios";

const DATE_TAG = "#EXT-X-PROGRAM-DATE-TIME:";

/** In-memory cache: `${prefer}:${originalUrl}` → { mediaUrl, expiresAt }. */
const renditionCache = new Map();
const RENDITION_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve a (possibly relative) playlist URI against a base URL.
 * When the child has no query string, inherit the parent's (DVR startTime/endTime windows).
 * @param {string} ref
 * @param {string} baseUrl
 */
function absolutePlaylistUrl(ref, baseUrl) {
  const resolved = new URL(ref, baseUrl);
  try {
    const base = new URL(baseUrl);
    if (!resolved.search && base.search) resolved.search = base.search;
  } catch {
    /* keep resolved as-is */
  }
  return resolved.toString();
}

/**
 * @param {string} text
 * @param {string} baseUrl
 * @returns {Array<{ url: string, bandwidth: number, width: number, height: number }>}
 */
function parseMasterRenditions(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const renditions = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;

    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
    const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    let uri = "";
    for (let j = i + 1; j < lines.length; j++) {
      const cand = lines[j].trim();
      if (!cand || cand.startsWith("#")) continue;
      uri = cand;
      break;
    }
    if (!uri) continue;

    renditions.push({
      url: absolutePlaylistUrl(uri, baseUrl),
      bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : Number.MAX_SAFE_INTEGER,
      width: resolutionMatch ? parseInt(resolutionMatch[1], 10) : 0,
      height: resolutionMatch ? parseInt(resolutionMatch[2], 10) : 0,
    });
  }
  return renditions;
}

/**
 * @param {Array<{ url: string, bandwidth: number, width: number, height: number }>} renditions
 * @param {"lowest"|"highest"} prefer
 */
function pickRendition(renditions, prefer) {
  const withArea = renditions.map((r) => ({ ...r, area: (r.width || 0) * (r.height || 0) }));
  withArea.sort((a, b) => {
    const areaA = a.area > 0 ? a.area : prefer === "lowest" ? Number.MAX_SAFE_INTEGER : 0;
    const areaB = b.area > 0 ? b.area : prefer === "lowest" ? Number.MAX_SAFE_INTEGER : 0;
    if (areaA !== areaB) return prefer === "lowest" ? areaA - areaB : areaB - areaA;
    return prefer === "lowest" ? a.bandwidth - b.bandwidth : b.bandwidth - a.bandwidth;
  });
  return withArea[0];
}

/**
 * If `m3u8Url` is a master playlist (#EXT-X-STREAM-INF), return the preferred media playlist URL
 * (`lowest` or `highest` resolution). Otherwise return the original URL. Cached briefly.
 * @param {string} m3u8Url
 * @param {"lowest"|"highest"} prefer
 * @returns {Promise<string>}
 */
async function resolveMasterRenditionUrl(m3u8Url, prefer) {
  const url = String(m3u8Url || "").trim();
  if (!url || !/\.m3u8(\?|#|$)/i.test(url)) return url;

  const cacheKey = `${prefer}:${url}`;
  const cached = renditionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.mediaUrl;

  try {
    const response = await axios.get(url, {
      responseType: "text",
      timeout: 8000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300 || typeof response.data !== "string") {
      return url;
    }

    const text = response.data;
    let mediaUrl = url;
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const renditions = parseMasterRenditions(text, url);
      if (renditions.length > 0) {
        mediaUrl = pickRendition(renditions, prefer).url;
      }
    }

    renditionCache.set(cacheKey, {
      mediaUrl,
      expiresAt: Date.now() + RENDITION_TTL_MS,
    });
    return mediaUrl;
  } catch {
    return url;
  }
}

/**
 * Master → lowest-resolution media playlist (editor thumbs / transcript news).
 * @param {string} m3u8Url
 * @returns {Promise<string>}
 */
export async function resolveLowestRenditionUrl(m3u8Url) {
  return resolveMasterRenditionUrl(m3u8Url, "lowest");
}

/**
 * Master → highest-resolution media playlist (VOD capture posters).
 * @param {string} m3u8Url
 * @returns {Promise<string>}
 */
export async function resolveHighestRenditionUrl(m3u8Url) {
  return resolveMasterRenditionUrl(m3u8Url, "highest");
}

export async function fetchM3u8DateRange(hlsStreamUrl) {
  const response = await axios.get(hlsStreamUrl, { responseType: "text" });
  const text = response.data;

  let firstDate = null;
  let lastDate = null;

  let searchFrom = 0;
  const firstIdx = text.indexOf(DATE_TAG, searchFrom);
  if (firstIdx !== -1) {
    const lineEnd = text.indexOf("\n", firstIdx);
    const raw = text.substring(firstIdx + DATE_TAG.length, lineEnd).trim();
    firstDate = raw;
  }

  const lastIdx = text.lastIndexOf(DATE_TAG);
  if (lastIdx !== -1) {
    const lineEnd = text.indexOf("\n", lastIdx);
    const raw = text.substring(lastIdx + DATE_TAG.length, lineEnd === -1 ? undefined : lineEnd).trim();
    lastDate = raw;
  }

  if (!firstDate || !lastDate) {
    throw new Error("No EXT-X-PROGRAM-DATE-TIME tags found in m3u8");
  }

  return {
    startDate: new Date(firstDate).toISOString(),
    endDate: new Date(lastDate).toISOString(),
  };
}

/**
 * End time (unix seconds) of the last media segment in a **media** playlist, using
 * #EXT-X-PROGRAM-DATE-TIME for the first anchored segment and contiguous EXTINF chain.
 * @param {string} text
 * @returns {number | null}
 */
export function parseLastSegmentEndUnixSecFromMediaPlaylist(text) {
  const lines = text.split(/\r?\n/);
  let pendingPdtSec = null;
  /** @type {number | null} */
  let nextSegStartSec = null;
  /** @type {number | null} */
  let lastEndSec = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      const iso = line.slice("#EXT-X-PROGRAM-DATE-TIME:".length).trim();
      const ms = Date.parse(iso);
      pendingPdtSec = Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
      continue;
    }

    const inf = /^#EXTINF:([0-9.]+)\s*,/.exec(line);
    if (!inf) continue;

    const dur = parseFloat(inf[1]);
    if (!Number.isFinite(dur) || dur < 0) continue;

    const nextLine = lines[i + 1];
    if (nextLine == null) break;
    const uri = nextLine.trim();
    if (!uri || uri.startsWith("#")) continue;
    i++;

    if (pendingPdtSec != null) {
      nextSegStartSec = pendingPdtSec;
      pendingPdtSec = null;
    } else if (nextSegStartSec != null) {
      /* contiguous segment after previous */
    } else {
      continue;
    }

    const start = nextSegStartSec;
    lastEndSec = start + dur;
    nextSegStartSec = lastEndSec;
  }

  return lastEndSec;
}

function firstVariantPlaylistUrl(masterText, baseUrl) {
  const lines = masterText.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      return new URL(line, baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fetch playlist (resolve master → first variant) and infer live edge unix sec from media tags.
 * Falls back to `fallbackSec` when tags are missing or skew is huge.
 * @param {string} m3u8Url
 * @param {number} fallbackSec
 * @param {number} [maxSkewSec] default 600
 * @returns {Promise<number>}
 */
export async function inferStreamEdgeUnixSecFromM3u8(m3u8Url, fallbackSec, maxSkewSec = 600) {
  try {
    const r = await axios.get(m3u8Url, { responseType: "text", timeout: 8000, validateStatus: () => true });
    if (r.status < 200 || r.status >= 300 || typeof r.data !== "string") return fallbackSec;

    let text = r.data;
    if (text.includes("#EXT-X-STREAM-INF")) {
      const variant = firstVariantPlaylistUrl(text, m3u8Url);
      if (!variant) return fallbackSec;
      const r2 = await axios.get(variant, { responseType: "text", timeout: 8000, validateStatus: () => true });
      if (r2.status < 200 || r2.status >= 300 || typeof r2.data !== "string") return fallbackSec;
      text = r2.data;
    }

    const last = parseLastSegmentEndUnixSecFromMediaPlaylist(text);
    if (last == null || !Number.isFinite(last)) return fallbackSec;
    if (Math.abs(last - fallbackSec) > maxSkewSec) return fallbackSec;
    return last;
  } catch {
    return fallbackSec;
  }
}
