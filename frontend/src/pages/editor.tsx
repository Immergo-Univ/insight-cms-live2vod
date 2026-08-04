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
  REALTIME_SEEK_BACK_SEC,
  ZOOM_LEVELS_MS,
} from "@/components/editor/editor-constants";
import { EditorRealtimeSeekBar } from "@/components/editor/editor-realtime-seek-bar";
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
  defaultEditorSubClipEncodeFields,
  EDITOR_VERTICAL_CROP_BP_TIME_MERGE_SEC,
  normalizeEditorClipMainCategoryIds,
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
import { EditorSubtitleGenerateModal } from "@/components/editor/editor-subtitle-generate-modal";
import { EditorSubtitleBurnModal } from "@/components/editor/editor-subtitle-burn-modal";
import {
  buildDefaultSubtitleLocales,
  buildDefaultNewsLocales,
  mergeSubtitleLocalesWithTenantPool,
  selectedSubtitleLanguageCodes,
} from "@/utils/tenant-subtitle-defaults";
import {
  applyTranscriptNewsGenerateOff,
  applyTranscriptNewsGenerateOn,
  clipBurnInEnabled,
  clipHasSelectedSubtitleLocales,
  clipSubtitleGenerateEnabled,
  reconcileBurnInAfterLocaleChange,
  resolveClipBurnInLanguage,
} from "@/utils/editor-subclip-subtitles";
import { subtitlesConfigFromClip, transcribeRootFromClip } from "@/utils/editor-spec-subtitles";

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

/** One sub-clip spanning the full parent window (relative t=0 .. duration). */
function createDefaultFullWindowSubClip(
  clipState: EditorClipState,
  nowUnixSec: number,
  id: string,
  defaults?: {
    subtitlesDefaultEnabled?: boolean;
    transcriptNewsGenerateEnabled?: boolean;
    defaultSyndication?: EditorClipSyndication | undefined;
    defaultSubtitleSettings?: EditorSubtitleSettings;
    subtitleLocales?: Record<string, boolean>;
    newsLocales?: Record<string, boolean>;
    burnInDefault?: boolean;
  },
): EditorSubClip {
  const isRealtime = clipState.selectionMode === "realtime";
  const wallSpan = Math.max(
    FRAME_DURATION_SEC * 2,
    clipState.endTime - clipState.startTime,
  );
  const endTime = isRealtime
    ? Math.max(60, Math.floor(nowUnixSec) - clipState.startTime)
    : wallSpan;
  const transcriptNewsOn = defaults?.transcriptNewsGenerateEnabled === true;
  const subtitleOn = defaults?.subtitlesDefaultEnabled === true || transcriptNewsOn;
  const poolLocales = defaults?.subtitleLocales ?? buildDefaultSubtitleLocales(undefined);
  const newsLocales = defaults?.newsLocales ?? buildDefaultNewsLocales(undefined);
  return {
    id,
    order: 1,
    startTime: 0,
    endTime,
    ...defaultEditorSubClipEncodeFields(),
    subtitleGenerateEnabled: subtitleOn,
    subtitleMode: subtitleOn,
    burnInEnabled: subtitleOn && defaults?.burnInDefault === true,
    subtitleLocales: poolLocales,
    newsLocales,
    transcriptNewsGenerateEnabled: transcriptNewsOn,
    ...(subtitleOn && defaults?.defaultSubtitleSettings
      ? { subtitleSettings: defaults.defaultSubtitleSettings }
      : {}),
    ...(defaults?.defaultSyndication ? { syndication: defaults.defaultSyndication } : {}),
  };
}

function buildDefaultClipSyndication(opts: {
  youtubeEnabled?: boolean;
  twitterEnabled?: boolean;
  facebookEnabled?: boolean;
  instagramEnabled?: boolean;
  tiktokEnabled?: boolean;
}): EditorClipSyndication | undefined {
  const next: EditorClipSyndication = {};
  if (opts.youtubeEnabled) next.youtube = { enabled: true, options: {} };
  if (opts.twitterEnabled) next.twitter = { enabled: true, options: {} };
  if (opts.facebookEnabled) next.facebook = { enabled: true, options: {} };
  if (opts.instagramEnabled) next.instagram = { enabled: true, options: { mediaType: "reels" } };
  if (opts.tiktokEnabled) next.tiktok = { enabled: true, options: {} };
  return Object.keys(next).length ? next : undefined;
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
  const mainCategoryIds = normalizeEditorClipMainCategoryIds(c.mainCategory ?? []);
  return {
    editorClientClipId: c.id,
    order: c.order,
    startTime: c.startTime,
    endTime: c.endTime,
    metadata: {
      title: c.title?.trim() ?? "",
      description: c.description?.trim() ?? "",
      tags: normalizeEditorClipTagsList(c.tags ?? []),
      ...(mainCategoryIds.length ? { mainCategory: mainCategoryIds } : {}),
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
    ...(c.subtitleMode || c.subtitleGenerateEnabled
      ? (() => {
          const block = subtitlesConfigFromClip(c);
          return block ? { subtitles: block } : {};
        })()
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
  tenantForSpec: import("@/services/tenant-bff.service").TenantDto | null,
): EditorStateJson {
  const absEpochToIso = (absSec: number) => {
    const t = Number(absSec);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t * 1000);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  };
  const t0 = clipState.startTime;
  // Realtime clips may start before t0 (seek-back window): extend the archive window into
  // the past and re-express relative times as 0-based within [parentWallStart, parentWallEnd].
  const shift = Math.min(0, target.startTime);
  const parentWallStart = t0 + shift;
  const parentWallEnd = parentWallEndUnix(clipState, allClips, nowUnix);
  const parentClipUrl = buildClipWindowUrl(clipState, parentWallStart, parentWallEnd);

  let adsOut: EditorStateJson["ads"] = [];
  if (includeAds) {
    const overlapping = adsMarkers
      .filter((a) => a.endTime > target.startTime && a.startTime < target.endTime)
      .sort((a, b) => a.startTime - b.startTime);
    adsOut = overlapping.map((a, i) => ({
      index: i + 1,
      startTime: a.startTime - shift,
      endTime: a.endTime - shift,
      startProgramDateTime: absEpochToIso(t0 + a.startTime),
      endProgramDateTime: absEpochToIso(t0 + a.endTime),
    }));
  }

  const targetJson = editorSubClipToStateJsonClip(target);

  const transcribeSettings = loadRealtimeTranscribeSettings();
  const rootFromClip = transcribeRootFromClip(target, tenantForSpec);
  const rootTranscribe = clipSubtitleGenerateEnabled(target)
    ? {
        transcribeSpeakerDiarization: rootFromClip.transcribeSpeakerDiarization,
        transcribeGenerateNews: rootFromClip.transcribeGenerateNews,
        transcribeNewsLocales: rootFromClip.transcribeNewsLocales,
        transcribeInferSpeakerNames: rootFromClip.transcribeInferSpeakerNames,
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
    availableLanguages: rootFromClip.availableLanguages,
    subtitleLanguages: rootFromClip.subtitleLanguages,
    ...(clipState.channelId?.trim() ? { channelId: clipState.channelId.trim() } : {}),
    posters: [],
    clips: [{ ...targetJson, startTime: targetJson.startTime - shift, endTime: targetJson.endTime - shift, order: 1 }],
    ads: adsOut,
    ...rootTranscribe,
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

  const t0 = clipState.startTime;
  // Extend the archive window backwards to cover clips marked in the realtime seek-back window
  // (negative offsets), then re-express all relative times as 0-based within the window.
  const shift = Math.min(0, ...clips.map((c) => c.startTime));
  const parentWallStart = t0 + shift;
  const parentWallEnd = parentWallEndUnix(clipState, clips, nowUnix);
  const parentClipUrl = buildClipWindowUrl(clipState, parentWallStart, parentWallEnd);

  const sortedClips = [...clips].sort((a, b) => a.order - b.order);

  const adsOut: EditorStateJson["ads"] = includeAds
    ? ads.map((a, i) => ({
        index: i + 1,
        startTime: a.startTime - shift,
        endTime: a.endTime - shift,
        startProgramDateTime: absEpochToIso(t0 + a.startTime),
        endProgramDateTime: absEpochToIso(t0 + a.endTime),
      }))
    : [];

  return {
    clipUrl: parentClipUrl,
    sourceM3u8: clipState.sourceM3u8,
    startTime: parentWallStart,
    endTime: parentWallEnd,
    ...(clipState.channelId?.trim() ? { channelId: clipState.channelId.trim() } : {}),
    posters: [],
    clips: sortedClips.map((c) => {
      const j = editorSubClipToStateJsonClip(c);
      return { ...j, startTime: j.startTime - shift, endTime: j.endTime - shift };
    }),
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
  const appliedInitialTenantDefaultsRef = useRef(false);

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
  /**
   * Realtime playback position: either the live edge (`live`) or a fixed past window
   * (`window`) served by an archive URL with startTime/endTime. The window bounds are
   * pinned at scrub time so the player source (and thus the reload) stays stable while playing.
   */
  const [realtimePlayback, setRealtimePlayback] = useState<{
    mode: "live" | "window";
    windowStartEpoch: number;
    windowEndEpoch: number;
  }>({ mode: "live", windowStartEpoch: 0, windowEndEpoch: 0 });
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
  const {
    loading: tenantSettingsLoading,
    subtitlesEnabled: tenantSubtitlesEnabled,
    subtitlesDefaultEnabled,
    tenantDefaultSubtitleSettings,
    tenant,
    availableLanguages,
    newsButtonEnabled,
    newsDefaultGenerate,
    syndicationYoutubeEnabled,
    syndicationYoutubeDefaultEnabled,
    syndicationTwitterEnabled,
    syndicationTwitterDefaultEnabled,
    syndicationFacebookEnabled,
    syndicationFacebookDefaultEnabled,
    syndicationInstagramEnabled,
    syndicationInstagramDefaultEnabled,
    syndicationTiktokEnabled,
    syndicationTiktokDefaultEnabled,
    tenantId: editorTenantId,
  } =
    useTenantSettings();

  const defaultClipSyndication = useMemo(
    () =>
      buildDefaultClipSyndication({
        youtubeEnabled: syndicationYoutubeEnabled && syndicationYoutubeDefaultEnabled,
        twitterEnabled: syndicationTwitterEnabled && syndicationTwitterDefaultEnabled,
        facebookEnabled: syndicationFacebookEnabled && syndicationFacebookDefaultEnabled,
        instagramEnabled: syndicationInstagramEnabled && syndicationInstagramDefaultEnabled,
        tiktokEnabled: syndicationTiktokEnabled && syndicationTiktokDefaultEnabled,
      }),
    [
      syndicationYoutubeEnabled,
      syndicationYoutubeDefaultEnabled,
      syndicationTwitterEnabled,
      syndicationTwitterDefaultEnabled,
      syndicationFacebookEnabled,
      syndicationFacebookDefaultEnabled,
      syndicationInstagramEnabled,
      syndicationInstagramDefaultEnabled,
      syndicationTiktokEnabled,
      syndicationTiktokDefaultEnabled,
    ],
  );

  const defaultClipSubtitleFields = useMemo(() => {
    const locales = buildDefaultSubtitleLocales(tenant);
    const newsLocales = buildDefaultNewsLocales(tenant);
    // Tenant "Transcribe & News" default also enables VTT for all tenant languages.
    const transcriptNewsOn =
      tenantSubtitlesEnabled && newsButtonEnabled && tenant?.newsDefaultGenerate !== false;
    const subtitleOn =
      (tenantSubtitlesEnabled && subtitlesDefaultEnabled === true) || transcriptNewsOn;
    const burnInDefault = tenant?.subtitlesDefaultBurnIn === true;
    if (!subtitleOn) {
      return {
        subtitleGenerateEnabled: false,
        subtitleMode: false as const,
        burnInEnabled: false,
        subtitleLocales: locales,
        newsLocales,
        transcriptNewsGenerateEnabled: false,
      };
    }
    return {
      subtitleGenerateEnabled: true,
      subtitleMode: true as const,
      burnInEnabled: burnInDefault,
      subtitleLocales: locales,
      newsLocales,
      transcriptNewsGenerateEnabled: transcriptNewsOn,
      subtitleSettings: tenantDefaultSubtitleSettings,
    };
  }, [
    tenant,
    tenantSubtitlesEnabled,
    subtitlesDefaultEnabled,
    newsButtonEnabled,
    tenantDefaultSubtitleSettings,
  ]);

  useEffect(() => {
    if (appliedInitialTenantDefaultsRef.current) return;
    if (tenantSettingsLoading) return;
    if (mountSnapshot?.fromCache === true) {
      appliedInitialTenantDefaultsRef.current = true;
      return;
    }
    if (clipState?.selectionMode === "realtime") {
      appliedInitialTenantDefaultsRef.current = true;
      return;
    }
    setClips((prev) => {
      if (prev.length !== 1) return prev;
      const clip = prev[0];
      const wantsSubtitleDefaults =
        (tenantSubtitlesEnabled && subtitlesDefaultEnabled === true) ||
        (tenantSubtitlesEnabled && newsButtonEnabled && newsDefaultGenerate);
      const shouldSetSubtitle = wantsSubtitleDefaults && !clipSubtitleGenerateEnabled(clip);
      const shouldSetSyndication = Boolean(defaultClipSyndication && !clip.syndication);
      if (!shouldSetSubtitle && !shouldSetSyndication) return prev;
      appliedInitialTenantDefaultsRef.current = true;
      return [
        {
          ...clip,
          ...(shouldSetSubtitle ? defaultClipSubtitleFields : {}),
          ...(shouldSetSyndication
            ? { syndication: JSON.parse(JSON.stringify(defaultClipSyndication)) }
            : {}),
        },
      ];
    });
    appliedInitialTenantDefaultsRef.current = true;
  }, [
    tenantSettingsLoading,
    mountSnapshot?.fromCache,
    clipState?.selectionMode,
    tenantSubtitlesEnabled,
    subtitlesDefaultEnabled,
    newsButtonEnabled,
    newsDefaultGenerate,
    defaultClipSyndication,
    defaultClipSubtitleFields,
  ]);

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
    tenantSubtitlesEnabled && clipBurnInEnabled(selectedEncodeClip ?? undefined);
  const subtitleSettingsForPlayer = normalizeEditorSubtitleSettings(
    selectedEncodeClip?.subtitleSettings ?? tenantDefaultSubtitleSettings,
  );

  const [realtimeTick, setRealtimeTick] = useState(0);
  useEffect(() => {
    if (!isRealtime) return;
    const id = window.setInterval(() => setRealtimeTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isRealtime]);

  /** Current live edge (Unix seconds). Ticks every second while in realtime mode. */
  const liveEpoch = useMemo(
    () => (isRealtime ? Math.floor(Date.now() / 1000) : 0),
    // realtimeTick drives the recompute each second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isRealtime, realtimeTick],
  );
  /** Oldest scrubbable instant (Unix seconds): live edge minus the 1h seek-back buffer. */
  const realtimeMinEpoch = liveEpoch - REALTIME_SEEK_BACK_SEC;

  /**
   * Player source. In realtime `window` mode we serve a fixed archive window
   * [windowStart, windowEnd]; otherwise the raw live URL. Depends only on the pinned
   * window bounds (not on the per-second tick) so the player is not recreated while playing.
   */
  const playerClipUrl = useMemo(() => {
    if (!clipState) return "";
    if (isRealtime && realtimePlayback.mode === "window") {
      return buildClipWindowUrl(
        clipState,
        realtimePlayback.windowStartEpoch,
        realtimePlayback.windowEndEpoch,
      );
    }
    return clipState.clipUrl;
  }, [isRealtime, realtimePlayback, clipState]);

  /** Absolute Unix epoch under the playhead: live edge in `live` mode, window start + player time in `window` mode. */
  const playheadEpoch = useCallback((): number => {
    if (!isRealtime) return 0;
    if (realtimePlayback.mode === "window") {
      const t = playerRef.current?.getCurrentTime() ?? 0;
      return realtimePlayback.windowStartEpoch + Math.floor(t);
    }
    return Math.floor(Date.now() / 1000);
  }, [isRealtime, realtimePlayback]);

  /** Playhead epoch for display/slider (recomputed each tick and on currentTime change). */
  const playheadEpochValue = useMemo(() => {
    if (!isRealtime) return 0;
    if (realtimePlayback.mode === "window") {
      return realtimePlayback.windowStartEpoch + Math.floor(currentTime);
    }
    return liveEpoch;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealtime, realtimePlayback, currentTime, liveEpoch]);

  const handleRealtimeGoLive = useCallback(() => {
    setRealtimePlayback((prev) => (prev.mode === "live" ? prev : { ...prev, mode: "live" }));
  }, []);

  const handleRealtimeScrub = useCallback(
    (targetEpoch: number) => {
      const live = Math.floor(Date.now() / 1000);
      const minEpoch = live - REALTIME_SEEK_BACK_SEC;
      // Scrubbing to (or past) the live edge returns to live playback.
      if (targetEpoch >= live - 2) {
        setRealtimePlayback({ mode: "live", windowStartEpoch: 0, windowEndEpoch: 0 });
        return;
      }
      const start = Math.min(Math.max(targetEpoch, minEpoch), live);
      setRealtimePlayback({ mode: "window", windowStartEpoch: start, windowEndEpoch: live });
    },
    [],
  );

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
            ...defaultClipSubtitleFields,
            ...(defaultClipSyndication ? { syndication: JSON.parse(JSON.stringify(defaultClipSyndication)) } : {}),
          },
        ];
      });
      setSelectedClipId(id);
    },
    [clipState, selectedClipId, isRealtime, clips, duration, zoomIndex, defaultClipSyndication, defaultClipSubtitleFields],
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
            ...defaultClipSubtitleFields,
            ...(defaultClipSyndication ? { syndication: JSON.parse(JSON.stringify(defaultClipSyndication)) } : {}),
          },
        ];
      });
      setSelectedClipId(id);
      timelineRef.current?.scrollTimeToCenter(timeSeconds);
    },
    [clipState, clips, duration, isRealtime, zoomIndex, currentTime, defaultClipSyndication, defaultClipSubtitleFields],
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
    const nowUnix = Date.now() / 1000;
    // Mark In/Out track the playhead, which may be in the past (scrubbed window).
    // Offsets are relative to the session t0 and can be negative (down to -REALTIME_SEEK_BACK_SEC).
    const liveHeadOffset = Math.floor(nowUnix) - clipState.startTime;
    const offset = playheadEpoch() - clipState.startTime;

    if (realtimeRecordingClipId === null) {
      setSelectedAdId(null);
      const windowSec = (ZOOM_LEVELS_MS[zoomIndex] ?? ZOOM_LEVELS_MS[0]) / 1000;
      // Placeholder Mark Out = playhead + zoom window, capped at the live head (never past live).
      const cap = Math.max(liveHeadOffset, offset + FRAME_DURATION_SEC);
      const end = Math.min(offset + windowSec, cap);
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
            ...defaultClipSubtitleFields,
            ...(defaultClipSyndication ? { syndication: JSON.parse(JSON.stringify(defaultClipSyndication)) } : {}),
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
  }, [
    clipState,
    realtimeRecordingClipId,
    clips,
    duration,
    isRealtime,
    zoomIndex,
    playheadEpoch,
    tenantSubtitlesEnabled,
    subtitlesDefaultEnabled,
    defaultClipSyndication,
    tenantDefaultSubtitleSettings,
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
      patch: Pick<EditorSubClip, "title" | "description" | "posters" | "tags" | "mainCategory">,
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
      // Realtime allows a negative lower bound (up to the 1h seek-back window before t0).
      const minT = isRealtime
        ? Math.floor(Date.now() / 1000) - REALTIME_SEEK_BACK_SEC - clipState.startTime
        : 0;
      const r = clampClipTimeRange(startTime, endTime, maxT, FRAME_DURATION_SEC, minT);
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
      const minT = isRealtime
        ? Math.floor(Date.now() / 1000) - REALTIME_SEEK_BACK_SEC - clipState.startTime
        : 0;
      const r = clampClipTimeRange(startTime, endTime, maxT, FRAME_DURATION_SEC, minT);
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

  const [subtitleGenerateModalClipId, setSubtitleGenerateModalClipId] = useState<string | null>(null);
  const [subtitleBurnModalClipId, setSubtitleBurnModalClipId] = useState<string | null>(null);

  const subtitleGenerateModalClip = useMemo(
    () => (subtitleGenerateModalClipId ? clips.find((c) => c.id === subtitleGenerateModalClipId) ?? null : null),
    [clips, subtitleGenerateModalClipId],
  );
  const subtitleBurnModalClip = useMemo(
    () => (subtitleBurnModalClipId ? clips.find((c) => c.id === subtitleBurnModalClipId) ?? null : null),
    [clips, subtitleBurnModalClipId],
  );

  const handleSaveSubtitleGenerate = useCallback(
    (clipId: string, payload: { generateEnabled: boolean; subtitleLocales: Record<string, boolean> }) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== clipId) return c;
          if (!payload.generateEnabled || selectedSubtitleLanguageCodes(payload.subtitleLocales).length === 0) {
            return {
              ...c,
              subtitleGenerateEnabled: false,
              subtitleMode: false,
              burnInEnabled: false,
              ...applyTranscriptNewsGenerateOff(tenant),
            };
          }
          const merged = reconcileBurnInAfterLocaleChange(c, payload.subtitleLocales);
          return {
            ...c,
            subtitleGenerateEnabled: true,
            subtitleMode: true,
            subtitleLocales: merged.subtitleLocales,
            burnInEnabled: merged.burnInEnabled,
            subtitleSettings: merged.subtitleSettings,
          };
        }),
      );
    },
    [tenant],
  );

  const handleSetClipTranscriptNewsGenerate = useCallback(
    (clipId: string, enabled: boolean) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== clipId) return c;
          if (!enabled) return { ...c, ...applyTranscriptNewsGenerateOff(tenant) };
          return {
            ...c,
            ...applyTranscriptNewsGenerateOn(c, tenant, tenantDefaultSubtitleSettings),
          };
        }),
      );
    },
    [tenant, tenantDefaultSubtitleSettings],
  );

  const handleSaveSubtitleBurn = useCallback(
    (clipId: string, payload: { burnInEnabled: boolean; burnInLanguage: string; settings: EditorSubtitleSettings }) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== clipId) return c;
          return {
            ...c,
            burnInEnabled: payload.burnInEnabled,
            subtitleSettings: normalizeEditorSubtitleSettings(payload.settings),
          };
        }),
      );
    },
    [],
  );

  const handleUpdateClipNewsLocales = useCallback(
    (clipId: string, newsLocales: Record<string, boolean>) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== clipId) return c;
          const anyOn = Object.values(newsLocales).some(Boolean);
          if (!anyOn) {
            return { ...c, newsLocales, transcriptNewsGenerateEnabled: false };
          }
          // Selecting a news locale with the master off turns the package on (+ VTT).
          if (c.transcriptNewsGenerateEnabled !== true) {
            return {
              ...c,
              ...applyTranscriptNewsGenerateOn(c, tenant, tenantDefaultSubtitleSettings),
              newsLocales,
            };
          }
          return { ...c, newsLocales, transcriptNewsGenerateEnabled: true };
        }),
      );
    },
    [tenant, tenantDefaultSubtitleSettings],
  );

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
    // Replays after every realtime source swap (live <-> past window).
  }, [playerClipUrl, clipState?.clipUrl, clipState?.selectionMode]);

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
        clipSubtitleGenerateEnabled(clip) &&
        !clipHasSelectedSubtitleLocales(clip)
      ) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: "Select at least one subtitle language for this clip before encoding.",
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
        const spec = buildSingleClipEditorStateJson(clipState, clips, clip, ads, includeAds, nowSec, tenant);
        await startVodJob(spec, { editorClipId: clipId });
        await refreshVodJobs();
      } catch (err) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: httpClient.getErrorMessage(err),
        }));
      }
    },
    [clipState, clips, ads, refreshVodJobs, tenant],
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
              clipUrl={playerClipUrl}
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
              clipWidgets={selectedEncodeClip?.widgets ?? []}
              onClipWidgetsChange={handleClipWidgetsChange}
              clipWidgetFocusRequestId={clipWidgetFocusRequestId}
              onClipWidgetFocusRequestHandled={handleClipWidgetFocusRequestHandled}
              clipWidgetTimelineContext={clipWidgetTimelineContext}
            />
            {isRealtime && (
              <div className="mt-2 w-full">
                <EditorRealtimeSeekBar
                  liveEpoch={liveEpoch}
                  minEpoch={realtimeMinEpoch}
                  playheadEpoch={playheadEpochValue}
                  mode={realtimePlayback.mode}
                  onScrub={handleRealtimeScrub}
                  onGoLive={handleRealtimeGoLive}
                  timeZone={clientTimeZone}
                />
              </div>
            )}
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
              onOpenClipSubtitleGenerate={
                tenantSubtitlesEnabled ? (clipId) => setSubtitleGenerateModalClipId(clipId) : undefined
              }
              onOpenClipSubtitleBurn={
                tenantSubtitlesEnabled ? (clipId) => setSubtitleBurnModalClipId(clipId) : undefined
              }
              subtitlesControlsEnabled={tenantSubtitlesEnabled}
              availableLanguages={availableLanguages}
              syndicationTenantId={editorTenantId}
              syndicationYoutubeEnabled={syndicationYoutubeEnabled}
              syndicationYoutubeDefaultEnabled={syndicationYoutubeDefaultEnabled}
              syndicationTwitterEnabled={syndicationTwitterEnabled}
              syndicationTwitterDefaultEnabled={syndicationTwitterDefaultEnabled}
              syndicationFacebookEnabled={syndicationFacebookEnabled}
              syndicationFacebookDefaultEnabled={syndicationFacebookDefaultEnabled}
              syndicationInstagramEnabled={syndicationInstagramEnabled}
              syndicationInstagramDefaultEnabled={syndicationInstagramDefaultEnabled}
              syndicationTiktokEnabled={syndicationTiktokEnabled}
              syndicationTiktokDefaultEnabled={syndicationTiktokDefaultEnabled}
              onCaptureClipPoster={handleCaptureClipPoster}
              onAddTextWidget={handleAddTextWidget}
              onAddImageWidgetFromFile={handleAddImageWidgetFromFile}
              transcriptNewsUiEnabled={newsButtonEnabled}
              onUpdateClipNewsLocales={handleUpdateClipNewsLocales}
              onSetClipTranscriptNewsGenerate={handleSetClipTranscriptNewsGenerate}
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

      {subtitleGenerateModalClip ? (
        <EditorSubtitleGenerateModal
          isOpen={!!subtitleGenerateModalClipId}
          onOpenChange={(open) => {
            if (!open) setSubtitleGenerateModalClipId(null);
          }}
          generateEnabled={clipSubtitleGenerateEnabled(subtitleGenerateModalClip)}
          subtitleLocales={mergeSubtitleLocalesWithTenantPool(
            subtitleGenerateModalClip.subtitleLocales,
            tenant,
          )}
          availableLanguages={availableLanguages}
          onSave={(payload) => {
            handleSaveSubtitleGenerate(subtitleGenerateModalClip.id, payload);
            setSubtitleGenerateModalClipId(null);
          }}
        />
      ) : null}

      {subtitleBurnModalClip ? (
        <EditorSubtitleBurnModal
          isOpen={!!subtitleBurnModalClipId}
          onOpenChange={(open) => {
            if (!open) setSubtitleBurnModalClipId(null);
          }}
          burnInEnabled={subtitleBurnModalClip.burnInEnabled === true}
          burnInLanguage={resolveClipBurnInLanguage(subtitleBurnModalClip)}
          settings={normalizeEditorSubtitleSettings(
            subtitleBurnModalClip.subtitleSettings ?? tenantDefaultSubtitleSettings,
          )}
          subtitleLocales={mergeSubtitleLocalesWithTenantPool(subtitleBurnModalClip.subtitleLocales, tenant)}
          onSave={(payload) => {
            handleSaveSubtitleBurn(subtitleBurnModalClip.id, payload);
            setSubtitleBurnModalClipId(null);
          }}
        />
      ) : null}
    </div>
  );
}
