import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  editorSessionKey,
  readEditorSessionDraftForMount,
  setEditorSessionDraft,
} from "@/services/editor-session-cache";
import type { EditorSessionDraft } from "@/services/editor-session-cache";
import { ArrowLeft } from "@untitledui/icons";
import { useLocation, useNavigate } from "react-router";
import { useTimezone } from "@/hooks/use-timezone";
import {
  EditorPlayer,
  EditorTimeline,
  EditorRealtimeRecBar,
  EditorJsonButton,
  EditorRightPanel,
} from "@/components/editor";
import { httpClient } from "@/services/http-client";
import { uploadEditorWidgetImages } from "@/services/editor-widget-images.service";
import { cancelVodJob, startVodJob } from "@/services/vod.service";
import { useVodProcessing } from "@/providers/vod-processing-provider";
import { useTenantSettings } from "@/providers/tenant-settings-provider";
import type { VodJobRecord } from "@/types/vod-job";
import { pickLatestVodEncodeJobForEditorClip } from "@/types/vod-job";
import {
  FRAME_DURATION_SEC,
  ZOOM_LEVELS_MS,
} from "@/components/editor/editor-constants";
import type { RealtimeTranscribeSettings } from "@/components/editor/editor-transcribe-settings-modal";
import { clampClipTimeRange } from "@/components/editor/editor-timeline";
import type { EditorPlayerRef, EditorTimelineHandle } from "@/components/editor";
import { detectAds, getPrecalculatedAds } from "@/services/ads.service";
import type {
  EditorAdMarker,
  EditorClipImageWidget,
  EditorClipSyndication,
  EditorClipState,
  EditorClipTextWidget,
  EditorClipWidget,
  EditorStateJson,
  EditorStateJsonClip,
  EditorSubClip,
  EditorSubtitleSettings,
} from "@/types/editor";
import {
  adjustVerticalBreakpointsAfterClipBoundsChange,
  cloneEditorClipWidget,
  DEFAULT_EDITOR_SUBTITLE_SETTINGS,
  defaultEditorSubClipEncodeFields,
  EDITOR_VERTICAL_CROP_BP_TIME_MERGE_SEC,
  normalizeEditorClipTagsList,
  normalizeEditorSubtitleSettings,
  normalizeEditorVerticalCropPanSettings,
  normalizeVerticalCropBreakpointsForClip,
  resolveVerticalCropCenterXAtLocalTime,
} from "@/types/editor";
import type {
  EditorCropWindow,
  EditorVerticalCropBreakpoint,
  EditorVerticalCropPanSettings,
} from "@/types/editor";
import { installEditorConsoleTools } from "@/utils/editor-console-debug";
import { isValidWhisperSubtitlePair } from "@/types/editor-whisper-languages";

/** Default length for a manually inserted ad slot (seconds). */
const DEFAULT_NEW_AD_DURATION_SEC = 30;

const RT_TRANSCRIBE_SETTINGS_KEY = "live2vod-rt-transcribe-settings-v1";

function loadRealtimeTranscribeSettings(): RealtimeTranscribeSettings {
  try {
    const raw = sessionStorage.getItem(RT_TRANSCRIBE_SETTINGS_KEY);
    if (!raw) return { speakerDiarization: true, generateNews: true };
    const p = JSON.parse(raw) as Partial<RealtimeTranscribeSettings>;
    return {
      speakerDiarization: p.speakerDiarization !== false,
      generateNews: p.generateNews !== false,
    };
  } catch {
    return { speakerDiarization: true, generateNews: true };
  }
}

function persistRealtimeTranscribeSettings(s: RealtimeTranscribeSettings) {
  try {
    sessionStorage.setItem(RT_TRANSCRIBE_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** One sub-clip spanning the full parent window (relative t=0 .. duration). */
function createDefaultFullWindowSubClip(
  clipState: EditorClipState,
  nowUnixSec: number,
  id: string,
): EditorSubClip {
  const isRealtime = clipState.selectionMode === "realtime";
  const wallSpan = Math.max(
    FRAME_DURATION_SEC * 2,
    clipState.endTime - clipState.startTime,
  );
  const endTime = isRealtime
    ? Math.max(60, Math.floor(nowUnixSec) - clipState.startTime)
    : wallSpan;
  return {
    id,
    order: 1,
    startTime: 0,
    endTime,
    ...defaultEditorSubClipEncodeFields(),
  };
}

/** Keep user-placed slots when precalc/detect finishes (avoids wiping manual ads). */
function mergeFetchedAdsWithManual(prev: EditorAdMarker[], fetched: EditorAdMarker[]): EditorAdMarker[] {
  const manual = prev.filter((a) => a.addedManually);
  if (manual.length === 0) {
    return fetched.map((m, i) => ({ ...m, index: i + 1 }));
  }
  const combined = [...fetched, ...manual].sort((a, b) => a.startTime - b.startTime);
  return combined.map((m, i) => ({ ...m, index: i + 1 }));
}

function buildClipWindowUrl(state: EditorClipState, wallStartUnix: number, wallEndUnix: number): string {
  const base = state.sourceM3u8?.trim() || state.clipUrl;
  try {
    const url = new URL(base, typeof window !== "undefined" ? window.location.href : "http://localhost/");
    url.searchParams.set("startTime", String(wallStartUnix));
    url.searchParams.set("endTime", String(wallEndUnix));
    return url.toString();
  } catch {
    return state.clipUrl;
  }
}

/** Wall-clock end of the parent editor window (same as root startTime/endTime on the stream). */
function parentWallEndUnix(clipState: EditorClipState, subClips: EditorSubClip[], nowUnix: number): number {
  if (clipState.selectionMode === "realtime") {
    return (
      clipState.startTime +
      Math.max(
        60,
        subClips.length ? Math.max(...subClips.map((c) => c.endTime)) : 0,
        Math.floor(nowUnix) - clipState.startTime,
      )
    );
  }
  return clipState.endTime;
}

function editorSubClipToStateJsonClip(c: EditorSubClip): EditorStateJsonClip {
  const st = normalizeEditorSubtitleSettings(c.subtitleSettings);
  const clipDur = Math.max(0, c.endTime - c.startTime);
  const sortedBps =
    c.verticalCropMode && c.verticalCropBreakpoints?.length
      ? normalizeVerticalCropBreakpointsForClip(
          clipDur,
          c.verticalCropBreakpoints,
          c.cropWindow?.centerX ?? 0.5,
        )
      : null;
  const cropForJson =
    c.verticalCropMode && c.cropWindow
      ? {
          ...c.cropWindow,
          centerX: sortedBps?.[0]?.centerX ?? c.cropWindow.centerX,
        }
      : c.cropWindow;
  return {
    editorClientClipId: c.id,
    order: c.order,
    startTime: c.startTime,
    endTime: c.endTime,
    metadata: {
      title: c.title?.trim() ?? "",
      description: c.description?.trim() ?? "",
      tags: normalizeEditorClipTagsList(c.tags ?? []),
    },
    ...(c.posters?.length ? { posters: c.posters } : {}),
    ...(c.verticalCropMode && cropForJson ? { cropWindow: { ...cropForJson } } : {}),
    ...(sortedBps &&
    (sortedBps.length > 1 || sortedBps.some((b) => b.timeSeconds > 1e-3)) &&
    c.verticalCropMode
      ? { verticalCropBreakpoints: sortedBps.map((b) => ({ ...b })) }
      : {}),
    ...(c.verticalCropMode
      ? {
          verticalCropPanSettings: normalizeEditorVerticalCropPanSettings(c.verticalCropPanSettings),
        }
      : {}),
    ...(c.subtitleMode
      ? {
          subtitles: {
            enabled: true as const,
            whisperSourceLanguage: st.whisperSourceLanguage,
            whisperOutputLanguage: st.whisperOutputLanguage,
            style: { ...st.style },
            transcribeSpeakerDiarization: st.transcribeSpeakerDiarization,
            transcribeInferSpeakerNames: st.transcribeInferSpeakerNames,
            transcribeNewsLocales: {
              en: st.transcribeNewsLocales.en,
              es: st.transcribeNewsLocales.es,
              he: st.transcribeNewsLocales.he,
            },
          },
        }
      : {}),
    widgets: (c.widgets ?? []).map(cloneEditorClipWidget),
    ...(c.syndication ? { syndication: JSON.parse(JSON.stringify(c.syndication)) } : {}),
  };
}

function buildSingleClipEditorStateJson(
  clipState: EditorClipState,
  allClips: EditorSubClip[],
  target: EditorSubClip,
  adsMarkers: EditorAdMarker[],
  includeAds: boolean,
  nowUnix: number,
): EditorStateJson {
  const absEpochToIso = (absSec: number) => {
    const t = Number(absSec);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t * 1000);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  };
  const parentWallStart = clipState.startTime;
  const parentWallEnd = parentWallEndUnix(clipState, allClips, nowUnix);
  const parentClipUrl = buildClipWindowUrl(clipState, parentWallStart, parentWallEnd);

  let adsOut: EditorStateJson["ads"] = [];
  if (includeAds) {
    const overlapping = adsMarkers
      .filter((a) => a.endTime > target.startTime && a.startTime < target.endTime)
      .sort((a, b) => a.startTime - b.startTime);
    adsOut = overlapping.map((a, i) => ({
      index: i + 1,
      startTime: a.startTime,
      endTime: a.endTime,
      startProgramDateTime: absEpochToIso(parentWallStart + a.startTime),
      endProgramDateTime: absEpochToIso(parentWallStart + a.endTime),
    }));
  }

  const transcribeSettings = loadRealtimeTranscribeSettings();
  const subNorm = normalizeEditorSubtitleSettings(target.subtitleSettings);
  const nl = subNorm.transcribeNewsLocales;
  const rootTranscribe = target.subtitleMode
    ? {
        transcribeSpeakerDiarization: subNorm.transcribeSpeakerDiarization,
        transcribeGenerateNews: Boolean(nl.en || nl.es || nl.he),
        transcribeNewsLocales: { en: nl.en, es: nl.es, he: nl.he },
        transcribeInferSpeakerNames: subNorm.transcribeInferSpeakerNames,
      }
    : {
        transcribeSpeakerDiarization: transcribeSettings.speakerDiarization,
        transcribeGenerateNews: transcribeSettings.generateNews,
      };

  return {
    clipUrl: parentClipUrl,
    sourceM3u8: clipState.sourceM3u8,
    startTime: parentWallStart,
    endTime: parentWallEnd,
    posters: [],
    clips: [{ ...editorSubClipToStateJsonClip(target), order: 1 }],
    ads: adsOut,
    ...rootTranscribe,
  };
}

/** Spec for encoder-lite: audio extract from origin HLS + whisper only (no MP4). */
function buildRealtimeTranscribeSpec(
  clipState: EditorClipState,
  allClips: EditorSubClip[],
  clipStartRel: number,
  clipEndRel: number,
  nowUnix: number,
  transcribeSettings: RealtimeTranscribeSettings,
): EditorStateJson {
  const parentWallEnd = parentWallEndUnix(clipState, allClips, nowUnix);
  const parentClipUrl = buildClipWindowUrl(clipState, clipState.startTime, parentWallEnd);
  const st = DEFAULT_EDITOR_SUBTITLE_SETTINGS;
  return {
    clipUrl: parentClipUrl,
    sourceM3u8: clipState.sourceM3u8,
    startTime: clipState.startTime,
    endTime: parentWallEnd,
    posters: [],
    realtimeTranscribeOnly: true,
    transcribeSpeakerDiarization: transcribeSettings.speakerDiarization,
    transcribeGenerateNews: transcribeSettings.generateNews,
    clips: [
      {
        order: 1,
        startTime: clipStartRel,
        endTime: clipEndRel,
        metadata: {
          title: "",
          description: "",
          tags: normalizeEditorClipTagsList([]),
        },
        subtitles: {
          enabled: true,
          whisperSourceLanguage: st.whisperSourceLanguage,
          whisperOutputLanguage: st.whisperOutputLanguage,
          style: { ...st.style },
        },
      },
    ],
    ads: [],
    subtitles: {
      enabled: true,
      whisperSourceLanguage: st.whisperSourceLanguage,
      whisperOutputLanguage: st.whisperOutputLanguage,
      style: { ...st.style },
    },
  };
}

function vodJobIsActive(status: VodJobRecord["status"]): boolean {
  return (
    status === "queued" ||
    status === "processing" ||
    status === "uploading" ||
    status === "cancelling"
  );
}

function vodJobCanCancel(status: VodJobRecord["status"]): boolean {
  return vodJobIsActive(status);
}

/** Single editor encode spec: parent stream + all sub-clips + all ads (one POST /vod/jobs). */
function buildEditorStateJson(
  clipState: EditorClipState,
  clips: EditorSubClip[],
  ads: EditorAdMarker[],
  includeAds: boolean,
  nowUnix: number,
): EditorStateJson {
  const absEpochToIso = (absSec: number) => {
    const t = Number(absSec);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t * 1000);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  };

  const parentWallStart = clipState.startTime;
  const parentWallEnd = parentWallEndUnix(clipState, clips, nowUnix);
  const parentClipUrl = buildClipWindowUrl(clipState, parentWallStart, parentWallEnd);

  const sortedClips = [...clips].sort((a, b) => a.order - b.order);

  const adsOut: EditorStateJson["ads"] = includeAds
    ? ads.map((a, i) => ({
        index: i + 1,
        startTime: a.startTime,
        endTime: a.endTime,
        startProgramDateTime: absEpochToIso(parentWallStart + a.startTime),
        endProgramDateTime: absEpochToIso(parentWallStart + a.endTime),
      }))
    : [];

  return {
    clipUrl: parentClipUrl,
    sourceM3u8: clipState.sourceM3u8,
    startTime: parentWallStart,
    endTime: parentWallEnd,
    posters: [],
    clips: sortedClips.map((c) => editorSubClipToStateJsonClip(c)),
    ads: adsOut,
  };
}

function getEditorEffectiveDuration(
  clipState: EditorClipState,
  clips: EditorSubClip[],
  duration: number,
  isRealtime: boolean,
  nowUnixSec: number,
): number {
  const durationSeconds = isRealtime
    ? Math.max(
        60,
        clips.length ? Math.max(...clips.map((c) => c.endTime)) : 0,
        Math.floor(nowUnixSec) - clipState.startTime,
      )
    : clipState.endTime - clipState.startTime;
  return isRealtime
    ? durationSeconds
    : duration > 0 && Number.isFinite(duration)
      ? duration
      : durationSeconds;
}

function applySubClipBoundsWithVerticalCrop(
  c: EditorSubClip,
  newStart: number,
  newEnd: number,
): EditorSubClip {
  if (newEnd <= newStart) return c;
  const base: EditorSubClip = { ...c, startTime: newStart, endTime: newEnd };
  if (!c.verticalCropMode) return base;
  const adj = adjustVerticalBreakpointsAfterClipBoundsChange(
    c,
    newStart,
    newEnd,
    c.verticalCropBreakpoints,
    c.cropWindow?.centerX ?? 0.5,
  );
  if (!adj?.length) return base;
  return {
    ...base,
    verticalCropBreakpoints: adj,
    cropWindow: c.cropWindow
      ? { ...c.cropWindow, centerX: adj[0].centerX }
      : { aspectRatio: "9:16", centerX: adj[0].centerX },
  };
}

export function EditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const editorJsonDebug = useMemo(
    () => new URLSearchParams(location.search).get("debug") === "true",
    [location.search],
  );
  const clipState = location.state as EditorClipState | null;
  const clientTimeZone = useTimezone();

  const sessionKey = useMemo(
    () => (clipState ? editorSessionKey(clipState) : ""),
    [
      clipState?.channelId,
      clipState?.sourceM3u8,
      clipState?.clipUrl,
      clipState?.endTime,
      clipState?.startTime,
      clipState?.selectionMode,
    ],
  );

  const mountSnapshot = useMemo(
    () => (sessionKey ? readEditorSessionDraftForMount(sessionKey) : null),
    [sessionKey],
  );

  /** Shared id for initial default clip + selection (lazy state initializers run in order). */
  const defaultFullWindowClipIdRef = useRef<string | null>(null);

  const shouldSkipAdsFetchRef = useRef(!!mountSnapshot?.adsLoadComplete);

  const playerRef = useRef<EditorPlayerRef>(null);
  const timelineRef = useRef<EditorTimelineHandle>(null);
  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(() => mountSnapshot?.fromCache === true ? mountSnapshot.zoomIndex : 1);
  const [clips, setClips] = useState<EditorSubClip[]>(() => {
    if (mountSnapshot?.fromCache === true) {
      return mountSnapshot.clips;
    }
    if (!clipState?.clipUrl) {
      return [];
    }
    if (clipState.selectionMode === "realtime") {
      return [];
    }
    if (!defaultFullWindowClipIdRef.current) {
      defaultFullWindowClipIdRef.current = crypto.randomUUID();
    }
    return [
      createDefaultFullWindowSubClip(clipState, Date.now() / 1000, defaultFullWindowClipIdRef.current),
    ];
  });
  /** When set, Play plays only up to this time then pauses (for "play subclip"). */
  const [playUntilTime, setPlayUntilTime] = useState<number | null>(null);
  /** Subclip in "edit" mode: Mark In/Out update this clip; Play plays only this subclip. */
  const [selectedClipId, setSelectedClipId] = useState<string | null>(() => {
    if (mountSnapshot?.fromCache === true) {
      return mountSnapshot.selectedClipId;
    }
    if (!clipState?.clipUrl) {
      return null;
    }
    if (clipState.selectionMode === "realtime") {
      return null;
    }
    if (!defaultFullWindowClipIdRef.current) {
      defaultFullWindowClipIdRef.current = crypto.randomUUID();
    }
    return defaultFullWindowClipIdRef.current;
  });
  /** Ad slot selected on the timeline (trim handles + ring). Mutually exclusive with selectedClipId where enforced in UI. */
  const [selectedAdId, setSelectedAdId] = useState<string | null>(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.selectedAdId : null,
  );
  /** Subclip currently playing (from list row Play). Cleared on pause or when play reaches end. */
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  /** Realtime REC: clip id between Mark In and Mark Out (drives preview REC badge only). */
  const [realtimeRecordingClipId, setRealtimeRecordingClipId] = useState<string | null>(null);
  /** When true, completing a REC segment (Mark Out) queues a transcript job on origin HLS audio only. */
  const [realtimeTranscribeOnRec, setRealtimeTranscribeOnRec] = useState(false);
  const [realtimeTranscribeSettings, setRealtimeTranscribeSettings] = useState<RealtimeTranscribeSettings>(() =>
    loadRealtimeTranscribeSettings(),
  );

  useEffect(() => {
    persistRealtimeTranscribeSettings(realtimeTranscribeSettings);
  }, [realtimeTranscribeSettings]);
  const [clipVodEncodeErrors, setClipVodEncodeErrors] = useState<Record<string, string>>({});
  /** After adding a text widget, player overlay selects it (dashed frame + handles). */
  const [clipWidgetFocusRequestId, setClipWidgetFocusRequestId] = useState<string | null>(null);
  const { jobs: vodJobs, refreshJobs: refreshVodJobs } = useVodProcessing();
  const vodJobsRef = useRef(vodJobs);
  vodJobsRef.current = vodJobs;

  const [ads, setAds] = useState<EditorAdMarker[]>(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.ads : [],
  );
  const [adsLoadComplete, setAdsLoadComplete] = useState(() => mountSnapshot?.adsLoadComplete ?? false);
  const [adsLoading, setAdsLoading] = useState(() => {
    if (!clipState?.clipUrl) return false;
    if ((clipState.selectionMode ?? "epg") === "realtime") return false;
    return !(mountSnapshot?.adsLoadComplete ?? false);
  });
  const adsTriggeredRef = useRef(false);

  useEffect(() => {
    if (!sessionKey) return;
    const draft: EditorSessionDraft = {
      clips,
      posters: [],
      ads,
      zoomIndex,
      selectedClipId,
      selectedAdId,
      adsLoadComplete,
    };
    setEditorSessionDraft(sessionKey, draft);
  }, [sessionKey, clips, ads, zoomIndex, selectedClipId, selectedAdId, adsLoadComplete]);

  const selectionMode = clipState?.selectionMode ?? "epg";
  const isRealtime = selectionMode === "realtime";
  const { subtitlesEnabled: tenantSubtitlesEnabled, syndicationYoutubeEnabled, tenantId: editorTenantId } =
    useTenantSettings();

  const selectedEncodeClip = useMemo(
    () => (selectedClipId ? clips.find((c) => c.id === selectedClipId) ?? null : null),
    [clips, selectedClipId],
  );

  const clipWidgetTimelineContext = useMemo(
    () =>
      selectedEncodeClip
        ? {
            clipStartSec: selectedEncodeClip.startTime,
            clipEndSec: selectedEncodeClip.endTime,
            playheadSec: currentTime,
          }
        : null,
    [selectedEncodeClip, selectedEncodeClip?.startTime, selectedEncodeClip?.endTime, currentTime],
  );

  useEffect(() => {
    setClipWidgetFocusRequestId(null);
  }, [selectedClipId]);

  const handleClipWidgetFocusRequestHandled = useCallback(() => {
    setClipWidgetFocusRequestId(null);
  }, []);
  const verticalCropActive = !!(selectedEncodeClip?.verticalCropMode && selectedEncodeClip?.cropWindow);
  const verticalCropCenterX = useMemo(() => {
    const c = selectedEncodeClip;
    if (!c?.verticalCropMode || !c.cropWindow) return 0.5;
    const dur = Math.max(0, c.endTime - c.startTime);
    const localT = Math.min(Math.max(0, currentTime - c.startTime), dur);
    const bps = c.verticalCropBreakpoints;
    if (!bps?.length) return c.cropWindow.centerX;
    const sorted = [...bps].sort((a, b) => a.timeSeconds - b.timeSeconds);
    const pan = normalizeEditorVerticalCropPanSettings(c.verticalCropPanSettings);
    return resolveVerticalCropCenterXAtLocalTime(sorted, localT, c.cropWindow.centerX, pan);
  }, [
    selectedEncodeClip,
    selectedEncodeClip?.verticalCropMode,
    selectedEncodeClip?.cropWindow,
    selectedEncodeClip?.verticalCropBreakpoints,
    selectedEncodeClip?.verticalCropPanSettings,
    selectedEncodeClip?.startTime,
    selectedEncodeClip?.endTime,
    currentTime,
  ]);
  const subtitleOverlayActive =
    tenantSubtitlesEnabled && !!(selectedEncodeClip?.subtitleMode);
  const subtitleSettingsForPlayer = normalizeEditorSubtitleSettings(
    selectedEncodeClip?.subtitleSettings ?? DEFAULT_EDITOR_SUBTITLE_SETTINGS,
  );

  const [realtimeTick, setRealtimeTick] = useState(0);
  useEffect(() => {
    if (!isRealtime) return;
    const id = window.setInterval(() => setRealtimeTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isRealtime]);

  useEffect(() => {
    if (!tenantSubtitlesEnabled) setRealtimeTranscribeOnRec(false);
  }, [tenantSubtitlesEnabled]);

  useEffect(() => {
    if (!clipState?.clipUrl) return;
    if (shouldSkipAdsFetchRef.current) return;
    if (isRealtime) {
      if (adsTriggeredRef.current) return;
      adsTriggeredRef.current = true;
      setAds([]);
      setAdsLoading(false);
      setAdsLoadComplete(true);
      return;
    }
    if (adsTriggeredRef.current) return;
    adsTriggeredRef.current = true;

    const corner = clipState.logoCorner || "br";
    const { startTime: winStart, endTime: winEnd, channelId, sourceM3u8 } = clipState;
    const hlsBase =
      sourceM3u8 ||
      (() => {
        try {
          const u = new URL(clipState.clipUrl);
          u.search = "";
          return u.toString();
        } catch {
          return clipState.clipUrl;
        }
      })();

    setAdsLoading(true);

    const mapPrecalcToMarkers = () =>
      getPrecalculatedAds(hlsBase, winStart, winEnd, channelId).then((result) => {
        const markers: EditorAdMarker[] = [];
        for (const ad of result.ads) {
          const lo = Math.max(winStart, ad.startEpoch);
          const hi = Math.min(winEnd, ad.endEpoch);
          if (hi <= lo) continue;
          markers.push({
            id: crypto.randomUUID(),
            index: markers.length + 1,
            startTime: lo - winStart,
            endTime: hi - winStart,
          });
        }
        const fetched = markers.map((m, i) => ({ ...m, index: i + 1 }));
        setAds((prev) => mergeFetchedAdsWithManual(prev, fetched));
      });

    mapPrecalcToMarkers()
      .catch((err) => {
        console.warn("Precalculated ads unavailable, falling back to detect:", err);
        return detectAds(clipState.clipUrl, corner).then((result) => {
          const fetched = result.ads.map((ad, i) => ({
            id: crypto.randomUUID(),
            index: i + 1,
            startTime: ad.startOffsetSec,
            endTime: ad.endOffsetSec,
          }));
          setAds((prev) => mergeFetchedAdsWithManual(prev, fetched));
        });
      })
      .catch((err) => console.error("Ads load failed:", err))
      .finally(() => {
        setAdsLoading(false);
        setAdsLoadComplete(true);
      });
  }, [clipState, isRealtime]);

  const handleRemoveAd = useCallback((id: string) => {
    setAds((prev) => {
      const filtered = prev.filter((a) => a.id !== id);
      return filtered.map((a, i) => ({ ...a, index: i + 1 }));
    });
    setSelectedAdId((cur) => (cur === id ? null : cur));
  }, []);

  const handleSelectClip = useCallback((id: string | null) => {
    setSelectedAdId(null);
    setSelectedClipId(id);
  }, []);

  const handleSelectAd = useCallback((id: string | null) => {
    if (id !== null) {
      setSelectedClipId(null);
    }
    setSelectedAdId(id);
  }, []);

  const handleAdOrderChange = useCallback((adId: string, newIndex: number) => {
    setAds((prev) =>
      prev.map((a) => (a.id === adId ? { ...a, index: newIndex } : a)),
    );
  }, []);

  const handleResizeAd = useCallback(
    (id: string, newStartTime?: number, newEndTime?: number) => {
      setAds((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const start = newStartTime ?? a.startTime;
          const end = newEndTime ?? a.endTime;
          if (end <= start) return a;
          return { ...a, startTime: start, endTime: end };
        }),
      );
    },
    [],
  );

  // Clear selection if the selected clip was removed (e.g. from timeline)
  useEffect(() => {
    if (selectedClipId && !clips.some((c) => c.id === selectedClipId)) {
      setSelectedClipId(null);
    }
  }, [selectedClipId, clips]);

  useEffect(() => {
    if (realtimeRecordingClipId && !clips.some((c) => c.id === realtimeRecordingClipId)) {
      setRealtimeRecordingClipId(null);
    }
  }, [realtimeRecordingClipId, clips]);

  useEffect(() => {
    if (selectedAdId && !ads.some((a) => a.id === selectedAdId)) {
      setSelectedAdId(null);
    }
  }, [selectedAdId, ads]);

  const handleBack = () => navigate(-1);

  // When playing a subclip, pause at its end
  useEffect(() => {
    if (!isPlaying || playUntilTime === null) return;
    if (currentTime >= playUntilTime) {
      playerRef.current?.pause();
      setPlayUntilTime(null);
      setPlayingClipId(null);
    }
  }, [isPlaying, playUntilTime, currentTime]);

  const handlePlay = useCallback(() => {
    if (selectedClipId) {
      const clip = clips.find((c) => c.id === selectedClipId);
      if (clip) {
        setPlayUntilTime(clip.endTime);
        const t = playerRef.current?.getCurrentTime() ?? currentTime;
        const resumeInsideClip = t >= clip.startTime && t < clip.endTime;
        if (!resumeInsideClip) {
          playerRef.current?.seek(clip.startTime);
        }
        playerRef.current?.play();
        return;
      }
    }
    playerRef.current?.play();
  }, [selectedClipId, clips, currentTime]);

  const handlePause = useCallback(() => {
    playerRef.current?.pause();
    setPlayingClipId(null);
  }, []);

  const handlePlaySubclip = useCallback((clip: EditorSubClip) => {
    setPlayingClipId(clip.id);
    setPlayUntilTime(clip.endTime);
    playerRef.current?.seek(clip.startTime);
    playerRef.current?.play();
  }, []);

  const handleStop = useCallback(() => {
    playerRef.current?.pause();
    playerRef.current?.seek(0);
    setPlayUntilTime(null);
    setPlayingClipId(null);
  }, []);

  const handleMarkIn = useCallback(
    (timeSeconds: number) => {
      if (!clipState) return;
      setSelectedAdId(null);
      if (selectedClipId) {
        setClips((prev) =>
          prev.map((c) => {
            if (c.id !== selectedClipId) return c;
            if (timeSeconds >= c.endTime) return c;
            return applySubClipBoundsWithVerticalCrop(c, timeSeconds, c.endTime);
          }),
        );
        return;
      }
      const eff = getEditorEffectiveDuration(
        clipState,
        clips,
        duration,
        isRealtime,
        Date.now() / 1000,
      );
      const windowSec = (ZOOM_LEVELS_MS[zoomIndex] ?? ZOOM_LEVELS_MS[0]) / 1000;
      let end = Math.min(timeSeconds + windowSec, eff);
      if (end <= timeSeconds) {
        end = Math.min(timeSeconds + FRAME_DURATION_SEC, eff);
      }
      if (end <= timeSeconds) return;
      const id = crypto.randomUUID();
      setClips((prev) => {
        const nextOrder =
          prev.length === 0 ? 1 : Math.max(...prev.map((c) => c.order)) + 1;
        return [
          ...prev,
          {
            id,
            order: nextOrder,
            startTime: timeSeconds,
            endTime: end,
            ...defaultEditorSubClipEncodeFields(),
          },
        ];
      });
      setSelectedClipId(id);
    },
    [clipState, selectedClipId, isRealtime, clips, duration, zoomIndex],
  );

  /** Append a new sub-clip at the current playhead (same span logic as Mark In without selection). */
  const handleAddClipAtPlayhead = useCallback(
    (variant: "vertical" | "horizontal") => {
      if (!clipState?.clipUrl) return;
      setSelectedAdId(null);
      const timeSeconds = playerRef.current?.getCurrentTime() ?? currentTime;
      const eff = getEditorEffectiveDuration(
        clipState,
        clips,
        duration,
        isRealtime,
        Date.now() / 1000,
      );
      const windowSec = (ZOOM_LEVELS_MS[zoomIndex] ?? ZOOM_LEVELS_MS[0]) / 1000;
      let end = Math.min(timeSeconds + windowSec, eff);
      if (end <= timeSeconds) {
        end = Math.min(timeSeconds + FRAME_DURATION_SEC, eff);
      }
      if (end <= timeSeconds) return;
      const encodeBase = defaultEditorSubClipEncodeFields();
      const encode =
        variant === "vertical"
          ? {
              ...encodeBase,
              verticalCropMode: true,
              cropWindow: { aspectRatio: "9:16" as const, centerX: 0.5 },
              verticalCropBreakpoints: [
                {
                  id: crypto.randomUUID(),
                  timeSeconds: 0,
                  centerX: 0.5,
                },
              ],
              verticalCropPanSettings: normalizeEditorVerticalCropPanSettings({
                mode: "smooth",
                easing: "ease-in-out",
                motionSampleSec: 0.12,
              }),
            }
          : encodeBase;
      const id = crypto.randomUUID();
      setClips((prev) => {
        const nextOrder =
          prev.length === 0 ? 1 : Math.max(...prev.map((c) => c.order)) + 1;
        return [
          ...prev,
          {
            id,
            order: nextOrder,
            startTime: timeSeconds,
            endTime: end,
            ...encode,
          },
        ];
      });
      setSelectedClipId(id);
      timelineRef.current?.scrollTimeToCenter(timeSeconds);
    },
    [clipState, clips, duration, isRealtime, zoomIndex, currentTime],
  );

  const handleMarkOut = useCallback(
    (timeSeconds: number) => {
      if (!selectedClipId) return;
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== selectedClipId) return c;
          if (timeSeconds <= c.startTime) return c;
          return applySubClipBoundsWithVerticalCrop(c, c.startTime, timeSeconds);
        }),
      );
    },
    [selectedClipId],
  );

  const handleRealtimeRec = useCallback(() => {
    if (!clipState || clipState.selectionMode !== "realtime") return;
    const offset = Math.floor(Date.now() / 1000) - clipState.startTime;
    const nowUnix = Date.now() / 1000;

    if (realtimeRecordingClipId === null) {
      setSelectedAdId(null);
      const eff = getEditorEffectiveDuration(clipState, clips, duration, isRealtime, nowUnix);
      const windowSec = (ZOOM_LEVELS_MS[zoomIndex] ?? ZOOM_LEVELS_MS[0]) / 1000;
      // At the live timeline head, `getEditorEffectiveDuration` often yields `eff === offset`, so
      // `min(offset + windowSec, eff)` becomes `offset` and we bail — REC / Space appear dead after a clip.
      const effForEnd = Math.max(eff, offset + FRAME_DURATION_SEC);
      const end = Math.min(offset + windowSec, effForEnd);
      if (end <= offset) return;
      const id = crypto.randomUUID();
      setClips((prev) => {
        const nextOrder =
          prev.length === 0 ? 1 : Math.max(...prev.map((c) => c.order)) + 1;
        return [
          ...prev,
          {
            id,
            order: nextOrder,
            startTime: offset,
            endTime: end,
            ...defaultEditorSubClipEncodeFields(),
          },
        ];
      });
      setSelectedClipId(id);
      setRealtimeRecordingClipId(id);
      return;
    }

    const rid = realtimeRecordingClipId;
    const cur = clips.find((c) => c.id === rid);
    if (!cur || offset <= cur.startTime) {
      setRealtimeRecordingClipId(null);
      setSelectedClipId(null);
      return;
    }
    const clipsAfter = clips.map((c) => {
      if (c.id !== rid) return c;
      return applySubClipBoundsWithVerticalCrop(c, c.startTime, offset);
    });
    setClips(clipsAfter);
    setRealtimeRecordingClipId(null);
    setSelectedClipId(null);

    if (realtimeTranscribeOnRec && httpClient.getTenantId()) {
      const nowSec = Date.now() / 1000;
      const spec = buildRealtimeTranscribeSpec(
        clipState,
        clipsAfter,
        cur.startTime,
        offset,
        nowSec,
        realtimeTranscribeSettings,
      );
      void (async () => {
        try {
          await startVodJob(spec, { editorClipId: rid });
          await refreshVodJobs();
        } catch {
          /* best-effort; WS may still show job if queued */
          await refreshVodJobs();
        }
      })();
    }
  }, [
    clipState,
    realtimeRecordingClipId,
    clips,
    duration,
    isRealtime,
    zoomIndex,
    realtimeTranscribeOnRec,
    realtimeTranscribeSettings,
    refreshVodJobs,
  ]);

  const handleRemoveClip = useCallback((id: string) => {
    setClips((prev) =>
      prev
        .filter((c) => c.id !== id)
        .map((c, i) => ({ ...c, order: i + 1 })),
    );
  }, []);

  const handleUpdateClipMetadata = useCallback(
    (
      clipId: string,
      patch: Pick<EditorSubClip, "title" | "description" | "posters" | "tags">,
    ) => {
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
      );
    },
    [],
  );

  const handleUpdateClipSyndication = useCallback((clipId: string, syndication: EditorClipSyndication | undefined) => {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        if (!syndication) {
          const { syndication: _removed, ...rest } = c;
          return rest;
        }
        return { ...c, syndication };
      }),
    );
  }, []);

  const handleResizeClip = useCallback(
    (id: string, newStartTime?: number, newEndTime?: number) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const start = newStartTime ?? c.startTime;
          const end = newEndTime ?? c.endTime;
          if (end <= start) return c;
          return applySubClipBoundsWithVerticalCrop(c, start, end);
        })
      );
    },
    []
  );

  const handleClipTimesCommitFromList = useCallback(
    (clipId: string, startTime: number, endTime: number): { startTime: number; endTime: number } | null => {
      if (!clipState?.clipUrl) return null;
      const maxT = getEditorEffectiveDuration(
        clipState,
        clips,
        duration,
        isRealtime,
        Date.now() / 1000,
      );
      const r = clampClipTimeRange(startTime, endTime, maxT, FRAME_DURATION_SEC);
      if (!r) return null;
      const cur = clips.find((c) => c.id === clipId);
      if (!cur) return null;
      if (cur.startTime === r.startTime && cur.endTime === r.endTime) return null;
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? applySubClipBoundsWithVerticalCrop(c, r.startTime, r.endTime) : c)),
      );
      playerRef.current?.seek(r.startTime);
      timelineRef.current?.scrollTimeToCenter(r.startTime);
      return r;
    },
    [clipState, clips, duration, isRealtime, realtimeTick],
  );

  const handleAdTimesCommitFromList = useCallback(
    (adId: string, startTime: number, endTime: number): { startTime: number; endTime: number } | null => {
      if (!clipState?.clipUrl) return null;
      const maxT = getEditorEffectiveDuration(
        clipState,
        clips,
        duration,
        isRealtime,
        Date.now() / 1000,
      );
      const r = clampClipTimeRange(startTime, endTime, maxT, FRAME_DURATION_SEC);
      if (!r) return null;
      const cur = ads.find((a) => a.id === adId);
      if (!cur) return null;
      if (cur.startTime === r.startTime && cur.endTime === r.endTime) return null;
      setAds((prev) => prev.map((a) => (a.id === adId ? { ...a, ...r } : a)));
      playerRef.current?.seek(r.startTime);
      timelineRef.current?.scrollTimeToCenter(r.startTime);
      return r;
    },
    [clipState, clips, duration, isRealtime, realtimeTick, ads],
  );

  const handleCaptureClipPoster = useCallback(
    (clipId: string) => {
      const t = playerRef.current?.getCurrentTime() ?? currentTime;
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;
      const clamped = Math.min(Math.max(t, clip.startTime), clip.endTime);
      const id = crypto.randomUUID();
      const capturedAt = new Date().toISOString();
      const orientation = clip.verticalCropMode ? "portrait" : "landscape";
      setClips((prev) =>
        prev.map((c) =>
          c.id === clipId
            ? {
                ...c,
                posters: [
                  ...(c.posters ?? []),
                  {
                    kind: "capture" as const,
                    id,
                    timeSeconds: clamped,
                    orientation,
                    capturedAt,
                  },
                ],
              }
            : c,
        ),
      );
    },
    [clips, currentTime],
  );

  const handleSeek = useCallback((timeSeconds: number) => {
    playerRef.current?.seek(timeSeconds);
  }, []);

  const handleSeekWithTimelineScroll = useCallback(
    (timeSeconds: number) => {
      handleSeek(timeSeconds);
      timelineRef.current?.scrollTimeToCenter(timeSeconds);
    },
    [handleSeek],
  );

  // Arrow keys: nudge playhead by one frame. Space: in realtime mode triggers REC (Mark In/Out); otherwise play/pause.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;

      if (e.key === " " || e.code === "Space") {
        if (e.repeat) return;
        e.preventDefault();
        // Stop propagation so focused clip rows (tabIndex + Space = toggle select) do not run after this.
        e.stopPropagation();
        if (isRealtime) {
          handleRealtimeRec();
        } else if (isPlaying) {
          handlePause();
        } else {
          handlePlay();
        }
        return;
      }

      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const inPlayerKeyboardSeek = target.closest("[data-editor-keyboard-seek]");
      if (
        (target.closest("button") || target.closest("a[href]")) &&
        !inPlayerKeyboardSeek
      ) {
        return;
      }
      e.preventDefault();
      const t = playerRef.current?.getCurrentTime() ?? currentTime;
      const dur = playerRef.current?.getDuration() ?? duration;
      const next =
        e.key === "ArrowLeft"
          ? Math.max(0, t - FRAME_DURATION_SEC)
          : Math.min(dur, t + FRAME_DURATION_SEC);
      playerRef.current?.seek(next);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    currentTime,
    duration,
    selectedClipId,
    clips,
    isPlaying,
    isRealtime,
    handlePlay,
    handlePause,
    handleRealtimeRec,
  ]);

  const handleSaveVerticalCropFromModal = useCallback(
    (
      clipId: string,
      patch: {
        verticalCropMode: boolean;
        cropWindow: EditorCropWindow | null;
        verticalCropBreakpoints: EditorVerticalCropBreakpoint[] | undefined;
        verticalCropPanSettings?: EditorVerticalCropPanSettings | undefined;
      },
    ) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== clipId) return c;
          return { ...c, ...patch };
        }),
      );
    },
    [],
  );

  const handleToggleClipSubtitle = useCallback((clipId: string) => {
    let turningOff = false;
    setClips((prev) => {
      const cur = prev.find((c) => c.id === clipId);
      turningOff = !!(cur?.subtitleMode);
      return prev.map((c) => {
        if (c.id !== clipId) return c;
        if (turningOff) return { ...c, subtitleMode: false };
        return {
          ...c,
          subtitleMode: true,
          subtitleSettings: normalizeEditorSubtitleSettings(c.subtitleSettings),
        };
      });
    });
  }, []);

  const handleVerticalCropCenterX = useCallback(
    (centerX: number) => {
      if (!selectedClipId) return;
      const tParent = playerRef.current?.getCurrentTime() ?? currentTime;
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== selectedClipId) return c;
          if (!c.verticalCropMode) return c;
          const clipLen = Math.max(FRAME_DURATION_SEC * 2, c.endTime - c.startTime);
          const localT = Math.min(Math.max(0, tParent - c.startTime), clipLen - 1e-6);
          const existing = [...(c.verticalCropBreakpoints ?? [])];
          const merge = EDITOR_VERTICAL_CROP_BP_TIME_MERGE_SEC;
          const matchIdx = existing.findIndex((bp) => Math.abs(bp.timeSeconds - localT) <= merge);
          let nextBps: EditorVerticalCropBreakpoint[];
          if (matchIdx >= 0) {
            nextBps = existing.map((bp, i) => (i === matchIdx ? { ...bp, centerX } : bp));
          } else {
            nextBps = [
              ...existing,
              { id: crypto.randomUUID(), timeSeconds: localT, centerX },
            ];
          }
          const normalized = normalizeVerticalCropBreakpointsForClip(
            c.endTime - c.startTime,
            nextBps,
            c.cropWindow?.centerX ?? 0.5,
          );
          return {
            ...c,
            verticalCropMode: true,
            cropWindow: {
              aspectRatio: "9:16" as const,
              centerX: normalized[0]?.centerX ?? centerX,
            },
            verticalCropBreakpoints: normalized,
          };
        }),
      );
    },
    [selectedClipId, currentTime],
  );

  const handleSelectedClipSubtitleSettingsChange = useCallback(
    (settings: EditorSubtitleSettings) => {
      if (!selectedClipId) return;
      const next = normalizeEditorSubtitleSettings(settings);
      setClips((prev) =>
        prev.map((c) => (c.id === selectedClipId ? { ...c, subtitleSettings: next } : c)),
      );
    },
    [selectedClipId],
  );

  const stateJson: EditorStateJson | null = useMemo(() => {
    if (!clipState?.clipUrl) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    return buildEditorStateJson(clipState, clips, ads, true, nowSec);
  }, [clipState, clips, ads, realtimeTick]);

  const stateJsonRef = useRef<EditorStateJson | null>(null);
  stateJsonRef.current = stateJson;

  useEffect(() => {
    return installEditorConsoleTools(() => stateJsonRef.current);
  }, []);

  useEffect(() => {
    if (!clipState?.clipUrl || clipState.selectionMode !== "realtime") return;
    const id = window.setTimeout(() => {
      void playerRef.current?.play();
    }, 500);
    return () => clearTimeout(id);
  }, [clipState?.clipUrl, clipState?.selectionMode]);

  if (!clipState?.clipUrl) {
    return (
      <div className="flex h-full flex-col bg-primary">
        <header className="flex items-center gap-3 border-b border-secondary px-4 py-3">
          <button
            onClick={handleBack}
            className="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-secondary"
          >
            <ArrowLeft className="size-4 text-fg-quaternary" />
          </button>
          <h1 className="text-lg font-semibold text-primary">Live2VOD</h1>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="text-sm text-tertiary">No clip data. Select a time window first.</p>
          <button
            onClick={handleBack}
            className="rounded-lg border border-secondary px-4 py-2 text-sm font-medium text-primary hover:bg-secondary"
          >
            Go back
          </button>
        </main>
      </div>
    );
  }

  const effectiveDuration = getEditorEffectiveDuration(
    clipState,
    clips,
    duration,
    isRealtime,
    Date.now() / 1000,
  );
  const channelId = clipState.channelId ?? "";

  const handleAddAdSlot = () => {
    if (isRealtime) return;
    const dur = effectiveDuration;
    if (dur <= 0) return;
    const t = Math.max(0, Math.min(currentTime, dur - 0.05));
    const end = Math.min(t + DEFAULT_NEW_AD_DURATION_SEC, dur);
    if (end <= t + 0.01) return;
    const id = crypto.randomUUID();
    setAds((prev) => {
      const next = [
        ...prev,
        { id, index: prev.length + 1, startTime: t, endTime: end, addedManually: true },
      ];
      return next.map((a, i) => ({ ...a, index: i + 1 }));
    });
    setSelectedAdId(id);
  };

  const handleClipStartVodEncode = useCallback(
    async (clipId: string, includeAds: boolean) => {
      if (!clipState?.clipUrl) return;
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      const existing = pickLatestVodEncodeJobForEditorClip(vodJobsRef.current, clipId);
      if (existing && vodJobIsActive(existing.status)) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: "This clip is already encoding. Stop the current job or wait until it finishes.",
        }));
        return;
      }

      if (!clip.title?.trim()) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: "Set a title for this clip (metadata control on the row).",
        }));
        return;
      }

      if (
        clip.subtitleMode &&
        !isValidWhisperSubtitlePair(
          (clip.subtitleSettings ?? DEFAULT_EDITOR_SUBTITLE_SETTINGS).whisperSourceLanguage,
          (clip.subtitleSettings ?? DEFAULT_EDITOR_SUBTITLE_SETTINGS).whisperOutputLanguage,
        )
      ) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: "Fix subtitle languages for this clip before encoding.",
        }));
        return;
      }

      if (!httpClient.getTenantId()) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: "Missing tenantId in the URL query string.",
        }));
        return;
      }

      setClipVodEncodeErrors((p) => {
        const next = { ...p };
        delete next[clipId];
        return next;
      });

      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const spec = buildSingleClipEditorStateJson(clipState, clips, clip, ads, includeAds, nowSec);
        await startVodJob(spec, { editorClipId: clipId });
        await refreshVodJobs();
      } catch (err) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: httpClient.getErrorMessage(err),
        }));
      }
    },
    [clipState, clips, ads, refreshVodJobs],
  );

  const handleClipCancelVodEncode = useCallback(
    async (clipId: string) => {
      const j = pickLatestVodEncodeJobForEditorClip(vodJobsRef.current, clipId);
      if (!j || !vodJobCanCancel(j.status)) return;
      try {
        await cancelVodJob(j.id);
        await refreshVodJobs();
      } catch {
        void refreshVodJobs();
      }
      setClipVodEncodeErrors((p) => {
        const next = { ...p };
        delete next[clipId];
        return next;
      });
    },
    [refreshVodJobs],
  );

  const handleClipWidgetsChange = useCallback((next: EditorClipWidget[]) => {
    if (!selectedClipId) return;
    setClips((prev) =>
      prev.map((c) => (c.id === selectedClipId ? { ...c, widgets: next } : c)),
    );
  }, [selectedClipId]);

  const handleAddTextWidget = useCallback((clipId: string) => {
    const nw: EditorClipTextWidget = {
      kind: "text",
      id: crypto.randomUUID(),
      html: "",
      color: "#ffffff",
      fontSizePx: 28,
      layout: { x: 0.08, y: 0.12, w: 0.84, h: 0.26 },
    };
    setClips((prev) =>
      prev.map((c) => (c.id !== clipId ? c : { ...c, widgets: [...(c.widgets ?? []), nw] })),
    );
    setSelectedClipId(clipId);
    setClipWidgetFocusRequestId(nw.id);
  }, []);

  const handleAddImageWidgetFromFile = useCallback(
    async (clipId: string, file: File) => {
      const ch = clipState?.channelId?.trim();
      if (!ch) {
        throw new Error("Channel ID is required to upload images.");
      }
      const rows = await uploadEditorWidgetImages(ch, [file]);
      const row = rows[0];
      if (!row) return;
      const nw: EditorClipImageWidget = {
        kind: "image",
        id: row.id,
        src: row.src,
        originalName: row.originalName,
        storedRelative: row.storedRelative,
        mime: row.mime,
        layout: { x: 0.1, y: 0.14, w: 0.55, h: 0.42 },
      };
      setClips((prev) =>
        prev.map((c) => (c.id !== clipId ? c : { ...c, widgets: [...(c.widgets ?? []), nw] })),
      );
      setSelectedClipId(clipId);
    },
    [clipState?.channelId],
  );

  return (
    <div className="flex h-full flex-col bg-primary">
      <header className="flex shrink-0 items-center gap-3 border-b border-secondary px-4 py-2">
        <button
          onClick={handleBack}
          className="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-secondary"
          aria-label="Go back"
        >
          <ArrowLeft className="size-4 text-fg-quaternary" />
        </button>
        <h1 className="text-lg font-semibold text-primary">Live2VOD Editor</h1>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Row 1: Player | Clips (clips column scrolls inside) */}
        <div className="flex min-h-0 flex-1 flex-row items-stretch gap-1.5 overflow-hidden px-4 py-2 sm:gap-2">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col self-start">
            <EditorPlayer
              ref={playerRef}
              clipUrl={clipState.clipUrl}
              muted={muted}
              onMutedChange={setMuted}
              onTimeUpdate={setCurrentTime}
              onDurationChange={setDuration}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              isPlaying={isPlaying}
              onTransportPlay={handlePlay}
              onTransportPause={handlePause}
              onTransportStop={handleStop}
              markRangeAwaitingOut={false}
              realtimeRecordingActive={isRealtime && realtimeRecordingClipId !== null}
                verticalCropActive={verticalCropActive}
                verticalCropCenterX={verticalCropCenterX}
                onVerticalCropCenterXChange={handleVerticalCropCenterX}
                subtitleOverlayActive={subtitleOverlayActive}
                subtitleSettings={subtitleSettingsForPlayer}
                onSubtitleSettingsChange={
                  tenantSubtitlesEnabled ? handleSelectedClipSubtitleSettingsChange : undefined
                }
              clipWidgets={selectedEncodeClip?.widgets ?? []}
              onClipWidgetsChange={handleClipWidgetsChange}
              clipWidgetFocusRequestId={clipWidgetFocusRequestId}
              onClipWidgetFocusRequestHandled={handleClipWidgetFocusRequestHandled}
              clipWidgetTimelineContext={clipWidgetTimelineContext}
            />
          </div>
          <aside className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col border-l border-secondary py-0 pl-2">
            <EditorRightPanel
              selectionMode={selectionMode}
              clips={clips}
              clipUrl={clipState.clipUrl}
              channelId={channelId}
              selectedClipId={selectedClipId}
              onSelectClip={handleSelectClip}
              playingClipId={playingClipId}
              isPlaying={isPlaying}
              onPlaySubclip={handlePlaySubclip}
              onPause={handlePause}
              onRemoveClip={handleRemoveClip}
              onUpdateClipMetadata={handleUpdateClipMetadata}
              onUpdateClipSyndication={handleUpdateClipSyndication}
              onSeek={handleSeekWithTimelineScroll}
              thumbnailsEnabled={!isRealtime}
              clipsEmptyHint={
                isRealtime
                  ? "Use REC to add Mark In / Mark Out segments."
                  : "Use Mark In / Mark Out to add ranges."
              }
              parentWindowDurationSec={effectiveDuration}
              onClipTimesCommit={handleClipTimesCommitFromList}
              onAdTimesCommit={handleAdTimesCommitFromList}
              onAddVerticalClip={() => handleAddClipAtPlayhead("vertical")}
              onAddHorizontalClip={() => handleAddClipAtPlayhead("horizontal")}
              onAddAdSlot={handleAddAdSlot}
              addAdSlotDisabled={isRealtime}
              vodJobs={vodJobs}
              clipVodEncodeErrors={clipVodEncodeErrors}
              onClipStartVodEncode={handleClipStartVodEncode}
              onClipCancelVodEncode={handleClipCancelVodEncode}
              ads={ads}
              selectedAdId={selectedAdId}
              onSelectAd={handleSelectAd}
              onRemoveAd={handleRemoveAd}
            onAdOrderChange={handleAdOrderChange}
              onSaveVerticalCropFromModal={handleSaveVerticalCropFromModal}
              onToggleClipSubtitle={
                tenantSubtitlesEnabled ? handleToggleClipSubtitle : undefined
              }
              syndicationTenantId={editorTenantId}
              syndicationYoutubeEnabled={syndicationYoutubeEnabled}
              onCaptureClipPoster={handleCaptureClipPoster}
              onAddTextWidget={handleAddTextWidget}
              onAddImageWidgetFromFile={handleAddImageWidgetFromFile}
              realtimeTranscriptUi={isRealtime && tenantSubtitlesEnabled}
              onVodJobsRefresh={refreshVodJobs}
          />
          </aside>
        </div>

        {/* Row 2: timeline full width below player + preview + clips */}
        <section className="flex w-full min-w-0 shrink-0 flex-col border-t border-dashed border-secondary px-4 py-2">
          {isRealtime ? (
            <EditorRealtimeRecBar
              clips={clips}
              awaitingMarkOut={realtimeRecordingClipId !== null}
              onRecPress={handleRealtimeRec}
              timeZone={clientTimeZone}
              clockTick={realtimeTick}
              transcribeOnRec={realtimeTranscribeOnRec}
              onTranscribeOnRecChange={setRealtimeTranscribeOnRec}
              transcribeSettings={realtimeTranscribeSettings}
              onTranscribeSettingsChange={setRealtimeTranscribeSettings}
              transcribeControlsEnabled={tenantSubtitlesEnabled}
            />
          ) : (
            <EditorTimeline
              ref={timelineRef}
              durationSeconds={effectiveDuration}
              currentTimeSeconds={currentTime}
              clipUrl={clipState.clipUrl}
              channelId={channelId}
              zoomIndex={zoomIndex}
              onZoomIndexChange={setZoomIndex}
              onSeek={handleSeek}
              onTrackClick={(time) => {
                handleSeek(time);
                setSelectedAdId(null);
              }}
              clips={clips}
              selectedClipId={selectedClipId}
              onSelectClip={handleSelectClip}
              onRemoveClip={handleRemoveClip}
              onResizeClip={handleResizeClip}
              ads={ads}
              adsLoading={adsLoading}
              onRemoveAd={handleRemoveAd}
              onResizeAd={handleResizeAd}
              selectedAdId={selectedAdId}
              onSelectAd={handleSelectAd}
              clipStartUnixSec={clipState.startTime}
              clientTimeZone={clientTimeZone}
              onMarkIn={handleMarkIn}
              onMarkOut={handleMarkOut}
            />
          )}
        </section>
      </main>

      {editorJsonDebug ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50">
          <div className="pointer-events-auto">
            <EditorJsonButton stateJson={stateJson} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
