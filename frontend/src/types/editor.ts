/**
 * Editor clip data passed from the previous step (time window selection).
 */
export interface EditorClipState {
  sourceM3u8: string;
  startTime: number;
  endTime: number;
  clipUrl: string;
  channelId?: string;
  logoCorner?: string;
}

/**
 * Ad marker detected by the ads detector. Times relative to clip (0 to duration).
 */
export interface EditorAdMarker {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
}

/**
 * Poster entry: time is relative to the clip (0 = start, duration = end).
 */
export interface EditorPosterEntry {
  id: string;
  /** Time in seconds from clip start (0 to clip duration). */
  timeSeconds: number;
  /** Orientation of the clip at capture time (e.g. "landscape"). */
  orientation: string;
  /** ISO date string when captured. */
  capturedAt: string;
}

/**
 * Sub-clip range (Mark In → Mark Out). Times relative to clip (0 to duration).
 * Order defines the final concatenation order in the output.
 */
export interface EditorSubClip {
  id: string;
  order: number;
  startTime: number;
  endTime: number;
}

/**
 * Full editor JSON state (for export / process).
 */
export interface EditorStateJson {
  clipUrl: string;
  sourceM3u8: string;
  startTime: number;
  endTime: number;
  posters: EditorPosterEntry[];
  clips: Array<{ order: number; startTime: number; endTime: number }>;
  ads: Array<{
    index: number;
    startTime: number;
    endTime: number;
    startProgramDateTime: string;
    endProgramDateTime: string;
  }>;
}
