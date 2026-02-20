/**
 * Thumbnail microservice base URL (same as reference Insight CMS).
 */
export const THUMBNAIL_API_BASE =
  "https://556gh0y4oh.execute-api.us-east-1.amazonaws.com/dev/genThumbTime";

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
