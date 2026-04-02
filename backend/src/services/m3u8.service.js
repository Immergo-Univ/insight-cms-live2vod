import axios from "axios";

const DATE_TAG = "#EXT-X-PROGRAM-DATE-TIME:";

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
