import type { WhisperLanguageCode, WhisperSubtitleOutputLanguage } from "./editor-whisper-languages";

export type { WhisperLanguageCode, WhisperSubtitleOutputLanguage } from "./editor-whisper-languages";

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
  cropWindow?: EditorCropWindow;
  subtitles?: EditorSubtitlesConfig;
}
