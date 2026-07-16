/**
 * Thumbnail API used by <img src> in the editor.
 * Goes through Live2VOD `/api/thumbnails`, which resolves HLS master playlists to the
 * lowest-resolution media playlist before calling the external genThumbTime service.
 */
export const THUMBNAIL_API_BASE = "/api/thumbnails";

/**
 * Zoom levels: milliseconds per column.
 * 3s, 1min, 5min, 10min, 15min, 1hr, 2hr
 */
export const ZOOM_LEVELS_MS: number[] = [
  3_000,       // 3 sec
  60_000,      // 1 min
  300_000,     // 5 min
  600_000,     // 10 min
  900_000,     // 15 min
  3_600_000,   // 1 hour
  7_200_000,   // 2 hours
];

export const ZOOM_LABELS: string[] = [
  "3 sec",
  "1 min",
  "5 min",
  "10 min",
  "15 min",
  "1 hour",
  "2 hours",
];

/** Fixed width per thumbnail column in the timeline (px). */
export const COLUMN_WIDTH_PX = 120;

/** Duration of one frame in seconds (30 fps). Used for arrow-key step. */
export const FRAME_DURATION_SEC = 1 / 30;

/**
 * Build thumbnail URL for a given time (seconds from clip start).
 */
export function buildThumbnailUrl(
  clipUrl: string,
  timeSeconds: number,
  channelId: string
): string {
  const params = new URLSearchParams();
  params.set("url", clipUrl);
  params.set("time", String(timeSeconds));
  params.set("channelId", channelId);
  return `${THUMBNAIL_API_BASE}?${params.toString()}`;
}

/** Seconds before clip end to sample mark-out stills (avoids windowed HLS tail past last decodable frame). */
const MARK_OUT_THUMB_SAFETY_MARGIN_SEC = 10;

/**
 * Sample time for mark-out thumbnails (seconds from parent window start).
 * Clamped so it never falls before mark-in (short clips reuse the in frame).
 */
export function markOutThumbnailTimeSec(startTime: number, endTime: number): number {
  return Math.max(startTime, endTime - MARK_OUT_THUMB_SAFETY_MARGIN_SEC);
}

/** genThumbTime URL for the mark-out still (safety margin before end when possible). */
export function buildMarkOutThumbnailUrl(
  clipUrl: string,
  startTime: number,
  endTime: number,
  channelId: string
): string {
  return buildThumbnailUrl(clipUrl, markOutThumbnailTimeSec(startTime, endTime), channelId);
}
