/**
 * Lightweight HLS playlist handling (no external deps).
 *
 * Responsibilities:
 *  - Detect master vs media playlist.
 *  - For a master playlist, pick the LOWEST resolution/bandwidth rendition (cheapest to grab a frame).
 *  - Resolve the remote media playlist URL that ffmpeg will read directly (live edge handled by ffmpeg).
 */

import { config } from "../config.js";

function absoluteUrl(ref, baseUrl) {
  try {
    return new URL(ref, baseUrl).toString();
  } catch {
    return ref;
  }
}

async function fetchText(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Some CDNs reject default fetch UA for HLS.
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function isMasterPlaylist(text) {
  return /#EXT-X-STREAM-INF/i.test(text);
}

/**
 * Parse a master playlist into rendition descriptors.
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
    // The URI is on the next non-comment line.
    let uri = "";
    for (let j = i + 1; j < lines.length; j++) {
      const cand = lines[j].trim();
      if (!cand || cand.startsWith("#")) continue;
      uri = cand;
      break;
    }
    if (!uri) continue;

    renditions.push({
      url: absoluteUrl(uri, baseUrl),
      bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : Number.MAX_SAFE_INTEGER,
      width: resolutionMatch ? parseInt(resolutionMatch[1], 10) : 0,
      height: resolutionMatch ? parseInt(resolutionMatch[2], 10) : 0,
    });
  }
  return renditions;
}

/**
 * Pick the cheapest rendition: lowest resolution (by pixel area) then lowest bandwidth.
 */
function pickLowestRendition(renditions) {
  const withArea = renditions.map((r) => ({ ...r, area: r.width * r.height }));
  withArea.sort((a, b) => {
    const areaA = a.area || Number.MAX_SAFE_INTEGER;
    const areaB = b.area || Number.MAX_SAFE_INTEGER;
    if (areaA !== areaB) return areaA - areaB;
    return a.bandwidth - b.bandwidth;
  });
  return withArea[0];
}

/**
 * Parse a media playlist into { targetDuration, segments: [{ url, duration }] }.
 */
function parseMediaSegments(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  let pendingDuration = 0;
  let targetDuration = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-TARGETDURATION")) {
      const m = line.match(/:(\d+(?:\.\d+)?)/);
      if (m) targetDuration = parseFloat(m[1]);
      continue;
    }
    if (line.startsWith("#EXTINF")) {
      const m = line.match(/#EXTINF:([\d.]+)/i);
      pendingDuration = m ? parseFloat(m[1]) : targetDuration || 0;
      continue;
    }
    if (line.startsWith("#")) continue;
    segments.push({ url: absoluteUrl(line, baseUrl), duration: pendingDuration || targetDuration || 0 });
    pendingDuration = 0;
  }
  return { targetDuration, segments };
}

/**
 * Resolve an input `video` URL into a concrete ffmpeg input describing the analysis window.
 *
 * For HLS we resolve the master playlist to the LOWEST rendition and hand ffmpeg the REMOTE media
 * playlist URL directly. ffmpeg then seeks the live edge (`-live_start_index -1`) or the tail of a
 * VOD (`-sseof`) downstream. Feeding the remote URL (http input) keeps http options like
 * `-user_agent` valid, which is not the case when ffmpeg reads a local `file://` playlist.
 *
 * @param {string} videoUrl
 * @param {string} _workDir kept for signature compatibility (no local files written anymore)
 * @returns {Promise<{ kind: "hls"|"file", ffmpegInput: string, isLive: boolean, meta: object }>}
 */
export async function resolveInput(videoUrl, _workDir) {
  const timeoutMs = Math.min(config.limits.requestTimeoutMs, 8000);
  const looksHls = /\.m3u8(\?|$)/i.test(videoUrl);

  if (!looksHls) {
    // mp4 (or any non-HLS URL/file). ffmpeg handles it directly; window is applied downstream.
    return { kind: "file", ffmpegInput: videoUrl, isLive: false, meta: {} };
  }

  let text = await fetchText(videoUrl, timeoutMs);
  let mediaUrl = videoUrl;
  const meta = { picked: null, master: false };

  if (isMasterPlaylist(text)) {
    meta.master = true;
    const renditions = parseMasterRenditions(text, videoUrl);
    if (renditions.length === 0) throw new Error("Master playlist has no renditions");
    const lowest = pickLowestRendition(renditions);
    meta.picked = { width: lowest.width, height: lowest.height, bandwidth: lowest.bandwidth };
    mediaUrl = lowest.url;
    text = await fetchText(mediaUrl, timeoutMs);
  }

  const { targetDuration, segments } = parseMediaSegments(text, mediaUrl);
  if (segments.length === 0) throw new Error("Media playlist has no segments");

  const hasEndlist = /#EXT-X-ENDLIST/i.test(text);
  const isLive = !hasEndlist;

  meta.segmentCount = segments.length;
  meta.targetDuration = targetDuration;

  return { kind: "hls", ffmpegInput: mediaUrl, isLive, meta };
}

export default { resolveInput };
