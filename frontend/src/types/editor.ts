import type { WhisperLanguageCode, WhisperSubtitleOutputLanguage } from "./editor-whisper-languages";

export type { WhisperLanguageCode, WhisperSubtitleOutputLanguage } from "./editor-whisper-languages";

/** How the user chose the clip window on Live2VOD (drives editor UI and export). */
export type EditorSelectionMode = "epg" | "timePicker" | "realtime";

/**
 * Editor clip data passed from the previous step (time window selection).
 */
export interface EditorClipState {
  sourceM3u8: string;
  startTime: number;
  endTime: number;
  clipUrl: string;
  channelId?: string;
  /** Display name from the channel list (e.g. Channel.title). */
  channelTitle?: string;
  logoCorner?: string;
  selectionMode?: EditorSelectionMode;
}

/** User-editable VOD metadata (sidebar + export JSON). */
export interface EditorVodMetadata {
  title: string;
  description: string;
  tags: string;
}

/**
 * Ad marker detected by the ads detector. Times relative to clip (0 to duration).
 * `addedManually`: user-placed slot (preserved when auto-detection results arrive).
 */
export interface EditorAdMarker {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  addedManually?: boolean;
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

/** Frame bookmark for a sub-clip (no image file; job may sample at timeSeconds). */
export interface EditorClipPosterCapture {
  kind: "capture";
  id: string;
  timeSeconds: number;
  orientation: string;
  capturedAt: string;
}

/** Uploaded still for a sub-clip (stored under S3/disk `posters/` like channel logos). */
export interface EditorClipPosterUpload {
  kind: "upload";
  id: string;
  originalName: string;
  storedRelative: string;
  previewUrl: string;
  mime: string;
}

export type EditorClipPoster = EditorClipPosterCapture | EditorClipPosterUpload;

/**
 * Sub-clip range (Mark In → Mark Out). Times relative to clip (0 to duration).
 * Order defines the final concatenation order in the output.
 */
export interface EditorSubClip {
  id: string;
  order: number;
  startTime: number;
  endTime: number;
  title?: string;
  description?: string;
  posters?: EditorClipPoster[];
}

/**
 * Vertical (9:16) crop over a wide frame: full frame height, width = height × 9/16, horizontally positioned.
 * centerX is normalized to the source width (0 = left, 1 = right).
 */
export interface EditorCropWindow {
  aspectRatio: "9:16";
  centerX: number;
}

/** Burned-in subtitle appearance (matches ffmpeg/libass force_style). */
export interface EditorSubtitleStyle {
  fontSizePx: number;
  /** Hex #RRGGBB */
  textColor: string;
  /** Hex #RRGGBB */
  outlineColor: string;
  outlineWidthPx: number;
}

/**
 * Editor state for subtitle preview + modal (not all fields are sent in JSON).
 * Video language → whisper -l hint; subtitle language → transcription or translate to English.
 */
export interface EditorSubtitleSettings {
  style: EditorSubtitleStyle;
  whisperSourceLanguage: WhisperLanguageCode;
  whisperOutputLanguage: WhisperSubtitleOutputLanguage;
}

/** Sent in JSON when subtitle mode is on. */
export interface EditorSubtitlesConfig {
  enabled: true;
  whisperSourceLanguage: WhisperLanguageCode;
  whisperOutputLanguage: WhisperSubtitleOutputLanguage;
  style: EditorSubtitleStyle;
  /** @deprecated Old jobs only; backend maps to source/output if present */
  languageMode?: string;
}

/** Sub-clip row in exported editor JSON (includes optional per-clip metadata). */
export interface EditorStateJsonClip {
  order: number;
  startTime: number;
  endTime: number;
  title?: string;
  description?: string;
  posters?: EditorClipPoster[];
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
  clips: EditorStateJsonClip[];
  ads: Array<{
    index: number;
    startTime: number;
    endTime: number;
    startProgramDateTime: string;
    endProgramDateTime: string;
  }>;
  cropWindow?: EditorCropWindow;
  subtitles?: EditorSubtitlesConfig;
  metadata?: EditorVodMetadata;
}
