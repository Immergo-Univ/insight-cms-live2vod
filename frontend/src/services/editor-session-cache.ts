import type {
  EditorAdMarker,
  EditorClipState,
  EditorCropWindow,
  EditorPosterEntry,
  EditorSubClip,
  EditorSubtitleSettings,
} from "@/types/editor";

/**
 * In-memory draft for one Live2VOD editor session (same browser tab lifecycle as the module).
 * Cleared on full page reload. A new timeline from Live2VOD uses a different key and starts fresh.
 */
export interface EditorSessionDraft {
  clips: EditorSubClip[];
  posters: EditorPosterEntry[];
  ads: EditorAdMarker[];
  verticalCropMode: boolean;
  cropWindow: EditorCropWindow | null;
  subtitleMode: boolean;
  subtitleSettings: EditorSubtitleSettings;
  zoomIndex: number;
  selectedClipId: string | null;
  selectedAdId: string | null;
  /** When true, skip automatic ad detection / precalc on remount (use cached `ads`). */
  adsLoadComplete: boolean;
}

const store = new Map<string, EditorSessionDraft>();

/** Prefer master playlist URL; avoid volatile clip URL query strings so session cache survives navigation. */
function streamIdentityForSessionKey(state: EditorClipState): string {
  const sm = state.sourceM3u8?.trim();
  if (sm) return sm;
  try {
    const u = new URL(
      state.clipUrl,
      typeof window !== "undefined" ? window.location.href : "http://localhost/",
    );
    u.search = "";
    return `${u.origin}${u.pathname}`;
  } catch {
    return state.clipUrl;
  }
}

/** Stable key for the selected archive window + stream (new window => new key => empty editor). */
export function editorSessionKey(state: EditorClipState): string {
  const mode = state.selectionMode ?? "epg";
  return [
    state.channelId ?? "",
    state.startTime,
    state.endTime,
    mode,
    streamIdentityForSessionKey(state),
  ].join("\u0001");
}

export function getEditorSessionDraft(key: string): EditorSessionDraft | undefined {
  return store.get(key);
}

export function setEditorSessionDraft(key: string, draft: EditorSessionDraft): void {
  store.set(key, draft);
}

function cloneSubtitleSettings(s: EditorSubtitleSettings): EditorSubtitleSettings {
  return {
    ...s,
    style: { ...s.style },
  };
}

export type EditorSessionMountSnapshot =
  | { fromCache: false; adsLoadComplete: false }
  | (Omit<EditorSessionDraft, "adsLoadComplete"> & { fromCache: true; adsLoadComplete: boolean });

/** Build initial React state from cache (immutable snapshots). */
export function readEditorSessionDraftForMount(key: string): EditorSessionMountSnapshot {
  const d = store.get(key);
  if (!d) {
    return { fromCache: false, adsLoadComplete: false };
  }
  return {
    fromCache: true,
    clips: d.clips.map((c) => ({ ...c, posters: c.posters ? [...c.posters] : undefined })),
    posters: d.posters.map((p) => ({ ...p })),
    ads: d.ads.map((a) => ({ ...a })),
    verticalCropMode: d.verticalCropMode,
    cropWindow: d.cropWindow ? { ...d.cropWindow } : null,
    subtitleMode: d.subtitleMode,
    subtitleSettings: cloneSubtitleSettings(d.subtitleSettings),
    zoomIndex: d.zoomIndex,
    selectedClipId: d.selectedClipId,
    selectedAdId: d.selectedAdId,
    adsLoadComplete: d.adsLoadComplete,
  };
}

