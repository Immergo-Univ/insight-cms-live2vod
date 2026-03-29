/**
 * Single source of truth for mapping logo-template-matching output to wall-clock storage.
 *
 * **Reference window:** the `startTime` and `endTime` query parameters on the streamPlaylist URL
 * (Unix epoch seconds). They bound which archive slice was requested.
 *
 * **Media timeline zero:** FFmpeg's demuxer timeline for that playlist usually starts at the first
 * decodable frame, which may not match `startTime` if the CDN omits early segments or pads the
 * window. When the matcher JSON includes `media_timeline_zero_epoch_utc` (from the first
 * `#EXT-X-PROGRAM-DATE-TIME` in the media playlist), ad instants are
 * `media_timeline_zero_epoch_utc + start_media_seconds`, then intersected with [startTime, endTime).
 *
 * The C tool reports `ad_segments` with `start_media_seconds` and `duration_media_seconds` relative
 * to demuxer t=0 for that same resolved playlist URL.
 */

/**
 * @param {number} playlistStartTimeEpoch URL `startTime` (inclusive), Unix seconds
 * @param {number} playlistEndTimeEpoch URL `endTime` (exclusive), Unix seconds
 * @param {{ start_media_seconds?: number, duration_media_seconds?: number }} seg
 * @param {{ mediaTimelineZeroEpochUtc?: number | null }} [options]
 * @returns {{ startEpoch: number, endEpoch: number } | null} intersection with [playlistStart, playlistEnd); null if empty
 */
export function absoluteAdIntervalFromMatcherSegment(
  playlistStartTimeEpoch,
  playlistEndTimeEpoch,
  seg,
  options = {},
) {
  const urlStart = Number(playlistStartTimeEpoch);
  const urlEnd = Number(playlistEndTimeEpoch);
  if (!Number.isFinite(urlStart) || !Number.isFinite(urlEnd) || urlEnd <= urlStart) return null;

  const anchorRaw = options.mediaTimelineZeroEpochUtc;
  const anchor =
    anchorRaw != null && Number.isFinite(Number(anchorRaw)) ? Number(anchorRaw) : urlStart;

  const rel0 = Number(seg?.start_media_seconds ?? 0);
  const dur = Number(seg?.duration_media_seconds ?? 0);
  if (!Number.isFinite(rel0) || !Number.isFinite(dur)) return null;

  const rawStart = anchor + rel0;
  const rawEnd = anchor + rel0 + dur;

  const is = Math.max(urlStart, rawStart);
  const ie = Math.min(urlEnd, rawEnd);

  if (ie <= is) return null;
  return { startEpoch: is, endEpoch: ie };
}

/**
 * @param {number} playlistStartTimeEpoch
 * @param {number} playlistEndTimeEpoch
 * @param {Array<{ start_media_seconds?: number, duration_media_seconds?: number }>} adSegments
 * @param {{ mediaTimelineZeroEpochUtc?: number | null }} [options]
 * @returns {Array<{ startEpoch: number, endEpoch: number, startProgramDateTime: string, endProgramDateTime: string }>}
 */
export function matcherSegmentsToIngestAds(
  playlistStartTimeEpoch,
  playlistEndTimeEpoch,
  adSegments,
  options = {},
) {
  const out = [];
  for (const seg of adSegments || []) {
    const abs = absoluteAdIntervalFromMatcherSegment(
      playlistStartTimeEpoch,
      playlistEndTimeEpoch,
      seg,
      options,
    );
    if (!abs) continue;
    out.push({
      startEpoch: abs.startEpoch,
      endEpoch: abs.endEpoch,
      startProgramDateTime: "",
      endProgramDateTime: "",
    });
  }
  return out;
}
