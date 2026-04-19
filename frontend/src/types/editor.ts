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

/** Per-clip / export metadata (title, description, tags). */
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

/** Default subtitle / whisper options for a new sub-clip or when fields are missing. */
export const DEFAULT_EDITOR_SUBTITLE_SETTINGS: EditorSubtitleSettings = {
  whisperSourceLanguage: "auto",
  whisperOutputLanguage: "same",
  style: {
    fontSizePx: 28,
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidthPx: 3,
  },
};

/**
 * Normalized rectangle (0–1) within the widget layout viewport:
 * full visible video frame when not in vertical crop, otherwise the 9:16 strip (same origin as vertical preview).
 */
export interface EditorClipWidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Timing on the sub-clip timeline (t = 0 at Mark In). Exported in JSON for the VOD encoder. */
export interface EditorClipWidgetTiming {
  /** Seconds from this sub-clip start when the overlay appears; default 0. */
  offsetIn?: number;
  /** Seconds from this sub-clip start when the overlay ends (exclusive, same sense as Mark Out); default = clip length. */
  offsetOut?: number;
}

export interface EditorClipTextWidget extends EditorClipWidgetTiming {
  kind: "text";
  id: string;
  /** Sanitized-ish HTML from the in-player WYSIWYG (innerHTML). */
  html: string;
  color: string;
  fontSizePx: number;
  layout: EditorClipWidgetLayout;
}

export interface EditorClipImageWidget extends EditorClipWidgetTiming {
  kind: "image";
  id: string;
  /** Preview URL (absolute or same-origin). */
  src: string;
  originalName?: string;
  storedRelative?: string;
  mime?: string;
  layout: EditorClipWidgetLayout;
}

export type EditorClipWidget = EditorClipTextWidget | EditorClipImageWidget;

export function cloneEditorClipWidget(w: EditorClipWidget): EditorClipWidget {
  return w.kind === "text"
    ? { ...w, layout: { ...w.layout } }
    : { ...w, layout: { ...w.layout } };
}

/** Encode options stored per sub-clip (UI + exported JSON). */
export interface EditorSubClipEncodeOptions {
  /** When true, output uses 9:16 strip crop using `cropWindow`. */
  verticalCropMode?: boolean;
  cropWindow?: EditorCropWindow | null;
  /** When true, whisper + burned-in subtitles using `subtitleSettings`. */
  subtitleMode?: boolean;
  subtitleSettings?: EditorSubtitleSettings;
  /** Over-video widgets (text / image) for this output clip; positions are relative to the widget viewport (see docs on `EditorClipWidgetLayout`). */
  widgets?: EditorClipWidget[];
}

/**
 * Sub-clip range (Mark In → Mark Out). Times relative to parent window (0 to duration).
 * `order` is a stable 1-based index (list order); each clip is encoded as its own output file.
 */
export interface EditorSubClip extends EditorSubClipEncodeOptions {
  id: string;
  order: number;
  startTime: number;
  endTime: number;
  title?: string;
  description?: string;
  posters?: EditorClipPoster[];
}

/** Sub-clip row in exported editor JSON (Mark In/Out relative to parent window t=0). */
export interface EditorStateJsonClip {
  order: number;
  startTime: number;
  endTime: number;
  /** Primary metadata for this output clip. */
  metadata?: EditorVodMetadata;
  /** @deprecated Prefer `metadata`; kept for older encoders */
  title?: string;
  description?: string;
  posters?: EditorClipPoster[];
  /** Per-output-clip vertical crop (independent from other clips). */
  cropWindow?: EditorCropWindow;
  /** Per-output-clip burned-in subtitles (whisper). */
  subtitles?: EditorSubtitlesConfig;
  /** Over-video widgets for this clip (layout relative to full frame or 9:16 strip when crop is on). */
  widgets?: EditorClipWidget[];
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
  /**
   * @deprecated Prefer `clips[].cropWindow` per output clip. Root value applies to all clips on old jobs only.
   */
  cropWindow?: EditorCropWindow;
  /**
   * @deprecated Prefer `clips[].subtitles` per output clip. Root value applies to all clips on old jobs only.
   */
  subtitles?: EditorSubtitlesConfig;
  /** @deprecated Use `clips[].metadata` per output clip */
  metadata?: EditorVodMetadata;
}

/** Defaults for encode-related fields when creating or hydrating a sub-clip. */
export function defaultEditorSubClipEncodeFields(): Required<
  Pick<EditorSubClipEncodeOptions, "verticalCropMode" | "cropWindow" | "subtitleMode">
> & { subtitleSettings: EditorSubtitleSettings } {
  return {
    verticalCropMode: false,
    cropWindow: null,
    subtitleMode: false,
    subtitleSettings: {
      ...DEFAULT_EDITOR_SUBTITLE_SETTINGS,
      style: { ...DEFAULT_EDITOR_SUBTITLE_SETTINGS.style },
    },
  };
}

/** Ensure optional encode fields exist (session cache / API hydration). */
export function normalizeEditorSubClip(c: EditorSubClip): EditorSubClip {
  const d = defaultEditorSubClipEncodeFields();
  return {
    ...c,
    verticalCropMode: c.verticalCropMode ?? d.verticalCropMode,
    cropWindow: c.cropWindow === undefined ? d.cropWindow : c.cropWindow,
    subtitleMode: c.subtitleMode ?? d.subtitleMode,
    subtitleSettings: c.subtitleSettings
      ? { ...c.subtitleSettings, style: { ...c.subtitleSettings.style } }
      : { ...d.subtitleSettings, style: { ...d.subtitleSettings.style } },
    posters: c.posters ? [...c.posters] : undefined,
    widgets: c.widgets?.length ? c.widgets.map(cloneEditorClipWidget) : undefined,
  };
}
