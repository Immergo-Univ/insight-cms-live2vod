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

const EDITOR_CLIP_TAG_MAX_LEN = 64;
const EDITOR_CLIP_TAGS_MAX = 100;

/**
 * Normalize clip tags from UI or hydrated JSON: trim, max length, dedupe (case-insensitive), cap count.
 */
export function normalizeEditorClipTagsList(raw: unknown): string[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim().length > 0
      ? raw
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const s = String(item).trim().slice(0, EDITOR_CLIP_TAG_MAX_LEN);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= EDITOR_CLIP_TAGS_MAX) break;
  }
  return out;
}

/** Per-clip / export metadata (title, description, tags). */
export interface EditorVodMetadata {
  title: string;
  description: string;
  /** Keywords for this output clip (exported as JSON array). */
  tags: string[];
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

/**
 * Keyframe for horizontal position of the 9:16 strip within the wide frame.
 * `timeSeconds` is relative to this sub-clip's start (Mark In = 0).
 */
export interface EditorVerticalCropBreakpoint {
  id: string;
  timeSeconds: number;
  centerX: number;
}

/** Hold crop until the next keyframe (legacy). */
export type EditorVerticalCropPanMode = "step" | "smooth";

/** Easing between keyframe centerX values when `mode` is smooth (preview + encode). */
export type EditorVerticalCropPanEasing = "linear" | "ease-in-out";

/**
 * How the vertical strip moves between keyframes in preview and encode.
 * When smooth, the encoder approximates motion with segments of at most `motionSampleSec`.
 */
export interface EditorVerticalCropPanSettings {
  mode: EditorVerticalCropPanMode;
  easing: EditorVerticalCropPanEasing;
  /** Max duration (seconds) of each constant-crop encode slice when mode is smooth; lower = smoother pan, more segments. */
  motionSampleSec: number;
}

export const DEFAULT_EDITOR_VERTICAL_CROP_PAN_SETTINGS: EditorVerticalCropPanSettings = {
  mode: "step",
  easing: "ease-in-out",
  motionSampleSec: 0.12,
};

export function normalizeEditorVerticalCropPanSettings(
  raw: EditorVerticalCropPanSettings | undefined,
): EditorVerticalCropPanSettings {
  const d = DEFAULT_EDITOR_VERTICAL_CROP_PAN_SETTINGS;
  const mode = raw?.mode === "smooth" || raw?.mode === "step" ? raw.mode : d.mode;
  const easing =
    raw?.easing === "linear" || raw?.easing === "ease-in-out" ? raw.easing : d.easing;
  let motionSampleSec = Number(raw?.motionSampleSec);
  if (!Number.isFinite(motionSampleSec)) motionSampleSec = d.motionSampleSec;
  motionSampleSec = Math.min(2, Math.max(0.03, motionSampleSec));
  return { mode, easing, motionSampleSec };
}

/** When dragging the strip at the same timeline position, merge into one keyframe (seconds). */
export const EDITOR_VERTICAL_CROP_BP_TIME_MERGE_SEC = 0.08;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function sortBreakpointsByTime(bps: EditorVerticalCropBreakpoint[]): EditorVerticalCropBreakpoint[] {
  return [...bps].sort((a, b) => a.timeSeconds - b.timeSeconds || a.id.localeCompare(b.id));
}

/** Collapse same-time entries to the last one (stable for UI). */
export function dedupeVerticalBreakpointsByTime(
  bps: EditorVerticalCropBreakpoint[],
  mergeSec = 1e-4,
): EditorVerticalCropBreakpoint[] {
  const sorted = sortBreakpointsByTime(bps);
  const out: EditorVerticalCropBreakpoint[] = [];
  for (const bp of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.timeSeconds - bp.timeSeconds) <= mergeSec) {
      out[out.length - 1] = { ...bp, timeSeconds: last.timeSeconds };
    } else {
      out.push({ ...bp });
    }
  }
  return out;
}

/**
 * Normalize breakpoints for a vertical clip: sorted, deduped, clamped to [0, duration].
 * Ensures a keyframe at t=0 when the list would otherwise start later (uses `fallbackCenterAtZero`).
 */
export function normalizeVerticalCropBreakpointsForClip(
  durationSec: number,
  bps: EditorVerticalCropBreakpoint[] | undefined,
  fallbackCenterAtZero: number,
): EditorVerticalCropBreakpoint[] {
  const dur = Math.max(0, Number(durationSec) || 0);
  const fb = clamp01(fallbackCenterAtZero);
  if (!bps?.length) {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `bp-${Date.now()}`;
    return [{ id, timeSeconds: 0, centerX: fb }];
  }
  const clamped = bps
    .filter((b) => b && typeof b.id === "string")
    .map((b) => ({
      id: b.id,
      timeSeconds: Math.min(dur, Math.max(0, Number(b.timeSeconds) || 0)),
      centerX: clamp01(Number(b.centerX)),
    }));
  let sorted = dedupeVerticalBreakpointsByTime(clamped);
  if (sorted.length === 0) {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `bp-${Date.now()}`;
    return [{ id, timeSeconds: 0, centerX: fb }];
  }
  if (sorted[0].timeSeconds > 1e-4) {
    const id0 =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `bp-${Date.now()}-0`;
    sorted = [{ id: id0, timeSeconds: 0, centerX: fb }, ...sorted];
    sorted = dedupeVerticalBreakpointsByTime(sorted);
  }
  return sortBreakpointsByTime(sorted.map((b) => (b.timeSeconds > dur ? { ...b, timeSeconds: dur } : b)));
}

function resolveVerticalCropCenterXStep(
  sortedBps: EditorVerticalCropBreakpoint[],
  localT: number,
  fallbackCenterX: number,
): number {
  const t = Number.isFinite(localT) ? localT : 0;
  let cx = clamp01(fallbackCenterX);
  for (const bp of sortedBps) {
    if (bp.timeSeconds <= t + 1e-9) cx = bp.centerX;
    else break;
  }
  return cx;
}

export function applyVerticalCropPanEasing(u: number, easing: EditorVerticalCropPanEasing): number {
  const x = Math.min(1, Math.max(0, u));
  if (easing === "linear") return x;
  return x * x * (3 - 2 * x);
}

/**
 * Resolved centerX at clip-local time `localT` (0 = Mark In). `sortedBps` must be sorted by `timeSeconds`.
 * When `pan` is omitted, step (hold) behavior is used for backwards compatibility.
 */
export function resolveVerticalCropCenterXAtLocalTime(
  sortedBps: EditorVerticalCropBreakpoint[],
  localT: number,
  fallbackCenterX: number,
  pan?: EditorVerticalCropPanSettings,
): number {
  const settings = normalizeEditorVerticalCropPanSettings(pan);
  const t = Number.isFinite(localT) ? localT : 0;
  if (!sortedBps.length) return clamp01(fallbackCenterX);
  if (settings.mode === "step") {
    return resolveVerticalCropCenterXStep(sortedBps, t, fallbackCenterX);
  }
  const first = sortedBps[0];
  const last = sortedBps[sortedBps.length - 1];
  if (t <= first.timeSeconds + 1e-9) return clamp01(first.centerX);
  if (t >= last.timeSeconds - 1e-9) return clamp01(last.centerX);
  for (let i = 0; i < sortedBps.length - 1; i++) {
    const a = sortedBps[i];
    const b = sortedBps[i + 1];
    if (t <= b.timeSeconds + 1e-9) {
      const span = b.timeSeconds - a.timeSeconds;
      if (span < 1e-9) return clamp01(b.centerX);
      const rawU = (t - a.timeSeconds) / span;
      const u = applyVerticalCropPanEasing(rawU, settings.easing);
      return clamp01(a.centerX + (b.centerX - a.centerX) * u);
    }
  }
  return clamp01(last.centerX);
}

export function adjustVerticalBreakpointsAfterClipBoundsChange(
  prevClip: EditorSubClip,
  newStartTime: number,
  newEndTime: number,
  breakpoints: EditorVerticalCropBreakpoint[] | undefined,
  cropWindowCenterFallback: number,
): EditorVerticalCropBreakpoint[] | undefined {
  if (!prevClip.verticalCropMode) return breakpoints;
  const newDur = Math.max(0, newEndTime - newStartTime);
  const fb = clamp01(cropWindowCenterFallback);
  if (!breakpoints?.length) {
    return normalizeVerticalCropBreakpointsForClip(newDur, [], fb);
  }
  const deltaStart = newStartTime - prevClip.startTime;
  const shifted = breakpoints.map((bp) => ({
    ...bp,
    timeSeconds: Math.min(newDur, Math.max(0, bp.timeSeconds - deltaStart)),
  }));
  return normalizeVerticalCropBreakpointsForClip(newDur, shifted, fb);
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
  /**
   * Image URL for in-browser preview and for the encoder job spec. Prefer HTTPS CDN when uploads use `widget-images/`;
   * otherwise same-origin `/api/.../editor/posters/:id/file`. Burning widgets into video is done only in encoder-lite.
   */
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
  /** Horizontal crop keyframes vs time within this sub-clip (Mark In = 0). */
  verticalCropBreakpoints?: EditorVerticalCropBreakpoint[];
  /** Motion between keyframes (preview + encode). */
  verticalCropPanSettings?: EditorVerticalCropPanSettings;
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
  /** Keywords for this output clip; exported under `clips[].metadata.tags`. */
  tags?: string[];
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
  /** Optional keyframed horizontal crop; when absent, encoder uses `cropWindow.centerX` only. */
  verticalCropBreakpoints?: EditorVerticalCropBreakpoint[];
  verticalCropPanSettings?: EditorVerticalCropPanSettings;
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
  /**
   * Encoder-lite: extract audio from origin HLS for clip bounds and run whisper only (no video encode).
   * Used for realtime editor transcript-after-REC.
   */
  realtimeTranscribeOnly?: boolean;
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
  const verticalCropMode = c.verticalCropMode ?? d.verticalCropMode;
  const cropWindow = c.cropWindow === undefined ? d.cropWindow : c.cropWindow;
  const clipDur = Math.max(0, Number(c.endTime) - Number(c.startTime));
  let verticalCropBreakpoints = c.verticalCropBreakpoints?.map((b) => ({ ...b })) as
    | EditorVerticalCropBreakpoint[]
    | undefined;
  if (verticalCropMode && cropWindow && (!verticalCropBreakpoints || verticalCropBreakpoints.length === 0)) {
    verticalCropBreakpoints = [
      {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `bp-${Date.now()}`,
        timeSeconds: 0,
        centerX: clamp01(cropWindow.centerX),
      },
    ];
  }
  if (verticalCropMode && verticalCropBreakpoints?.length) {
    verticalCropBreakpoints = normalizeVerticalCropBreakpointsForClip(
      clipDur,
      verticalCropBreakpoints,
      cropWindow?.centerX ?? 0.5,
    );
  } else {
    verticalCropBreakpoints = undefined;
  }
  let verticalCropPanSettings = c.verticalCropPanSettings;
  if (!verticalCropMode) {
    verticalCropPanSettings = undefined;
  } else if (verticalCropPanSettings) {
    verticalCropPanSettings = normalizeEditorVerticalCropPanSettings(verticalCropPanSettings);
  }
  return {
    ...c,
    verticalCropMode,
    cropWindow,
    verticalCropBreakpoints,
    verticalCropPanSettings,
    subtitleMode: c.subtitleMode ?? d.subtitleMode,
    subtitleSettings: c.subtitleSettings
      ? { ...c.subtitleSettings, style: { ...c.subtitleSettings.style } }
      : { ...d.subtitleSettings, style: { ...d.subtitleSettings.style } },
    tags: c.tags !== undefined ? normalizeEditorClipTagsList(c.tags) : undefined,
    posters: c.posters ? [...c.posters] : undefined,
    widgets: c.widgets?.length ? c.widgets.map(cloneEditorClipWidget) : undefined,
  };
}
