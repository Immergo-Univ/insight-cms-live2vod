import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Download01 } from "@untitledui/icons";
import { I18nextProvider, useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { useTimezone } from "@/hooks/use-timezone";
import {
  EditorPlayer,
  EditorTimeline,
  EditorJsonButton,
  EditorRightPanel,
} from "@/components/editor";
import type { EditorPlayerRef, EditorTimelineHandle } from "@/components/editor";
import { clampClipTimeRange } from "@/components/editor/editor-timeline";
import { FRAME_DURATION_SEC, ZOOM_LEVELS_MS } from "@/components/editor/editor-constants";
import { httpClient } from "@/services/http-client";
import { uploadEditorWidgetImages } from "@/services/editor-widget-images.service";
import { cancelVodJob, startVodJob } from "@/services/vod.service";
import { useVodProcessing } from "@/providers/vod-processing-provider";
import { useTenantSettings } from "@/providers/tenant-settings-provider";
import type { VodJobRecord } from "@/types/vod-job";
import { pickLatestVodEncodeJobForEditorClip } from "@/types/vod-job";
import type {
  EditorClipImageWidget,
  EditorClipPoster,
  EditorClipSyndication,
  EditorClipState,
  EditorClipTextWidget,
  EditorClipWidget,
  EditorCropWindow,
  EditorStateJson,
  EditorStateJsonClip,
  EditorSubClip,
  EditorSubtitleSettings,
  EditorVerticalCropBreakpoint,
  EditorVerticalCropPanSettings,
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
import { dubbingConfigFromClip, dubbingRootFromClip } from "@/utils/editor-spec-dubbing";
import {
  clipDubbingEnabled,
  clipHasSelectedDubbingLocales,
} from "@/utils/editor-subclip-dubbing";
import {
  buildDefaultDubbingLocales,
  defaultDubbingSourceLanguage,
  mergeDubbingLocalesWithTenantPool,
  selectedDubbingLanguageCodes,
  tenantAvailableDubbingLanguages,
  tenantDubbingEnabled,
} from "@/utils/tenant-dubbing-defaults";
import { EditorDubbingModal } from "@/components/editor/editor-dubbing-modal";
import type { WhisperLanguageCode } from "@/types/editor-whisper-languages";
import vodEditorI18n from "@/i18n/vod-editor-i18n";

/**
 * Source assets fed by insight-cms (VIDEO_EDITOR_IFRAME) via the `src` query
 * param: base64-encoded plaintext JSON with the entity `content` URLs.
 */
interface VodEditorAssets {
  hls: string;
  mp4: string[];
  posters: string[];
  /** Optional channel-like id used for thumbnails / poster uploads. */
  channelId?: string;
}

/** Decode the base64 (unicode-safe) plaintext assets JSON from the `src` query param. */
function decodeAssets(raw: string | null): VodEditorAssets | null {
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    const parsed = JSON.parse(json) as Partial<VodEditorAssets>;
    const hls = typeof parsed.hls === "string" ? parsed.hls : "";
    if (!hls) return null;
    return {
      hls,
      mp4: Array.isArray(parsed.mp4) ? parsed.mp4.filter((u): u is string => typeof u === "string") : [],
      posters: Array.isArray(parsed.posters)
        ? parsed.posters.filter((u): u is string => typeof u === "string")
        : [],
      channelId: typeof parsed.channelId === "string" ? parsed.channelId : undefined,
    };
  } catch {
    return null;
  }
}

/** Map source poster URLs (from `content`) to upload-kind poster entries so they prepopulate the gallery. */
function sourcePostersToClipPosters(urls: string[]): EditorClipPoster[] {
  return urls.map((url) => ({
    kind: "upload" as const,
    id: crypto.randomUUID(),
    originalName: url.split("/").pop() || "poster",
    storedRelative: url,
    previewUrl: url,
    mime: "",
  }));
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

/** Static VOD source: clip window params are appended for parity with the encode spec contract. */
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
    ...(clipDubbingEnabled(c)
      ? (() => {
          const block = dubbingConfigFromClip(c);
          return block ? { dubbing: block } : {};
        })()
      : {}),
    widgets: (c.widgets ?? []).map(cloneEditorClipWidget),
    ...(c.syndication ? { syndication: JSON.parse(JSON.stringify(c.syndication)) } : {}),
  };
}

/** Single-clip encode spec (no ads: VOD editor never includes ad markers). */
function buildSingleClipEditorStateJson(
  clipState: EditorClipState,
  target: EditorSubClip,
  tenantForSpec: import("@/services/tenant-bff.service").TenantDto | null,
): EditorStateJson {
  const parentWallStart = clipState.startTime;
  const parentWallEnd = clipState.endTime;
  const parentClipUrl = buildClipWindowUrl(clipState, parentWallStart, parentWallEnd);

  const targetJson = editorSubClipToStateJsonClip(target);
  const rootFromClip = transcribeRootFromClip(target, tenantForSpec);
  const rootDubbing = dubbingRootFromClip(target, tenantForSpec);
  const rootTranscribe = clipSubtitleGenerateEnabled(target)
    ? {
        transcribeSpeakerDiarization: rootFromClip.transcribeSpeakerDiarization,
        transcribeGenerateNews: rootFromClip.transcribeGenerateNews,
        transcribeNewsLocales: rootFromClip.transcribeNewsLocales,
        transcribeInferSpeakerNames: rootFromClip.transcribeInferSpeakerNames,
      }
    : {
        transcribeSpeakerDiarization: clipDubbingEnabled(target),
        transcribeGenerateNews: false,
      };

  return {
    clipUrl: parentClipUrl,
    sourceM3u8: clipState.sourceM3u8,
    startTime: parentWallStart,
    endTime: parentWallEnd,
    availableLanguages: rootFromClip.availableLanguages,
    subtitleLanguages: rootFromClip.subtitleLanguages,
    availableDubbingLanguages: rootDubbing.availableDubbingLanguages,
    dubbingLanguages: rootDubbing.dubbingLanguages,
    ...(clipState.channelId?.trim() ? { channelId: clipState.channelId.trim() } : {}),
    posters: [],
    clips: [{ ...targetJson, order: 1 }],
    ads: [],
    ...rootTranscribe,
  };
}

/** Full editor spec (all sub-clips, no ads) — used only for the debug JSON button. */
function buildEditorStateJson(clipState: EditorClipState, clips: EditorSubClip[]): EditorStateJson {
  const parentWallStart = clipState.startTime;
  const parentWallEnd = clipState.endTime;
  const parentClipUrl = buildClipWindowUrl(clipState, parentWallStart, parentWallEnd);
  const sortedClips = [...clips].sort((a, b) => a.order - b.order);
  return {
    clipUrl: parentClipUrl,
    sourceM3u8: clipState.sourceM3u8,
    startTime: parentWallStart,
    endTime: parentWallEnd,
    ...(clipState.channelId?.trim() ? { channelId: clipState.channelId.trim() } : {}),
    posters: [],
    clips: sortedClips.map((c) => editorSubClipToStateJsonClip(c)),
    ads: [],
  };
}

/** Effective duration in seconds: player-reported duration, else the parent window span. */
function getEditorEffectiveDuration(clipState: EditorClipState, duration: number): number {
  const durationSeconds = Math.max(0, clipState.endTime - clipState.startTime);
  return duration > 0 && Number.isFinite(duration) ? duration : durationSeconds;
}

function vodJobIsActive(status: VodJobRecord["status"]): boolean {
  return (
    status === "queued" ||
    status === "processing" ||
    status === "uploading" ||
    status === "cancelling"
  );
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

/** Embeddable VOD editor (replacement for the Angular VIDEO_EDITOR), without ADs markers. */
function VodEditorInner() {
  const { t } = useTranslation("vodEditor");
  const location = useLocation();
  const clientTimeZone = useTimezone();

  const editorJsonDebug = useMemo(
    () => new URLSearchParams(location.search).get("debug") === "true",
    [location.search],
  );

  const assets = useMemo(
    () => decodeAssets(new URLSearchParams(location.search).get("src")),
    [location.search],
  );

  const clipState: EditorClipState | null = useMemo(() => {
    if (!assets?.hls) return null;
    return {
      sourceM3u8: assets.hls,
      clipUrl: assets.hls,
      startTime: 0,
      endTime: 0, // filled from the player duration (see getEditorEffectiveDuration)
      channelId: assets.channelId ?? "",
      selectionMode: "timePicker",
    };
  }, [assets]);

  const sourcePosters = useMemo(
    () => sourcePostersToClipPosters(assets?.posters ?? []),
    [assets],
  );

  const playerRef = useRef<EditorPlayerRef>(null);
  const timelineRef = useRef<EditorTimelineHandle>(null);
  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(1);
  const [clips, setClips] = useState<EditorSubClip[]>([]);
  const [playUntilTime, setPlayUntilTime] = useState<number | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [clipVodEncodeErrors, setClipVodEncodeErrors] = useState<Record<string, string>>({});
  const [clipWidgetFocusRequestId, setClipWidgetFocusRequestId] = useState<string | null>(null);
  const didInitDefaultClipRef = useRef(false);

  const { jobs: vodJobs, refreshJobs: refreshVodJobs } = useVodProcessing();
  const vodJobsRef = useRef(vodJobs);
  vodJobsRef.current = vodJobs;

  const selectionMode = "timePicker" as const;

  const {
    loading: tenantSettingsLoading,
    subtitlesEnabled: tenantSubtitlesEnabled,
    subtitlesDefaultEnabled,
    tenantDefaultSubtitleSettings,
    tenant,
    availableLanguages,
    newsButtonEnabled,
    dubbingEnabled: tenantDubbingFlag,
    availableDubbingLanguages,
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
  } = useTenantSettings();

  const tenantDubbingOn = tenantDubbingFlag && availableDubbingLanguages.length > 0;

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
    const dubbingLocales = buildDefaultDubbingLocales(tenant);
    const transcriptNewsOn =
      tenantSubtitlesEnabled && newsButtonEnabled && tenant?.newsDefaultGenerate !== false;
    const subtitleOn =
      (tenantSubtitlesEnabled && subtitlesDefaultEnabled === true) || transcriptNewsOn;
    const burnInDefault = tenant?.subtitlesDefaultBurnIn === true;
    const dubbingOn = tenantDubbingEnabled(tenant) && tenant?.dubbingDefaultEnabled === true;
    if (!subtitleOn) {
      return {
        subtitleGenerateEnabled: false,
        subtitleMode: false as const,
        burnInEnabled: false,
        subtitleLocales: locales,
        newsLocales,
        transcriptNewsGenerateEnabled: false,
        dubbingEnabled: dubbingOn,
        dubbingSourceLanguage: defaultDubbingSourceLanguage(tenant),
        dubbingLocales,
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
      dubbingEnabled: dubbingOn,
      dubbingSourceLanguage: defaultDubbingSourceLanguage(tenant),
      dubbingLocales,
    };
  }, [
    tenant,
    tenantSubtitlesEnabled,
    subtitlesDefaultEnabled,
    newsButtonEnabled,
    tenantDefaultSubtitleSettings,
  ]);

  // Create the default full-window sub-clip once the player duration is known and tenant
  // settings are loaded (so tenant subtitle/syndication defaults + source posters apply).
  useEffect(() => {
    if (didInitDefaultClipRef.current) return;
    if (!clipState) return;
    if (tenantSettingsLoading) return;
    if (duration <= 0) return;
    didInitDefaultClipRef.current = true;
    const id = crypto.randomUUID();
    setClips([
      {
        id,
        order: 1,
        startTime: 0,
        endTime: duration,
        ...defaultEditorSubClipEncodeFields(),
        ...defaultClipSubtitleFields,
        ...(defaultClipSyndication
          ? { syndication: JSON.parse(JSON.stringify(defaultClipSyndication)) }
          : {}),
        ...(sourcePosters.length ? { posters: sourcePosters.map((p) => ({ ...p })) } : {}),
      },
    ]);
    setSelectedClipId(id);
  }, [
    clipState,
    duration,
    tenantSettingsLoading,
    defaultClipSubtitleFields,
    defaultClipSyndication,
    sourcePosters,
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
    [selectedEncodeClip, currentTime],
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
  }, [selectedEncodeClip, currentTime]);

  const subtitleOverlayActive =
    tenantSubtitlesEnabled && clipBurnInEnabled(selectedEncodeClip ?? undefined);
  const subtitleSettingsForPlayer = normalizeEditorSubtitleSettings(
    selectedEncodeClip?.subtitleSettings ?? tenantDefaultSubtitleSettings,
  );

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
        const tCur = playerRef.current?.getCurrentTime() ?? currentTime;
        const resumeInsideClip = tCur >= clip.startTime && tCur < clip.endTime;
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
      const eff = getEditorEffectiveDuration(clipState, duration);
      const windowSec = (ZOOM_LEVELS_MS[zoomIndex] ?? ZOOM_LEVELS_MS[0]) / 1000;
      let end = Math.min(timeSeconds + windowSec, eff);
      if (end <= timeSeconds) {
        end = Math.min(timeSeconds + FRAME_DURATION_SEC, eff);
      }
      if (end <= timeSeconds) return;
      const id = crypto.randomUUID();
      setClips((prev) => {
        const nextOrder = prev.length === 0 ? 1 : Math.max(...prev.map((c) => c.order)) + 1;
        return [
          ...prev,
          {
            id,
            order: nextOrder,
            startTime: timeSeconds,
            endTime: end,
            ...defaultEditorSubClipEncodeFields(),
            ...defaultClipSubtitleFields,
            ...(defaultClipSyndication
              ? { syndication: JSON.parse(JSON.stringify(defaultClipSyndication)) }
              : {}),
          },
        ];
      });
      setSelectedClipId(id);
    },
    [clipState, selectedClipId, clips, duration, zoomIndex, defaultClipSyndication, defaultClipSubtitleFields],
  );

  const handleAddClipAtPlayhead = useCallback(
    (variant: "vertical" | "horizontal") => {
      if (!clipState) return;
      const timeSeconds = playerRef.current?.getCurrentTime() ?? currentTime;
      const eff = getEditorEffectiveDuration(clipState, duration);
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
                { id: crypto.randomUUID(), timeSeconds: 0, centerX: 0.5 },
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
        const nextOrder = prev.length === 0 ? 1 : Math.max(...prev.map((c) => c.order)) + 1;
        return [
          ...prev,
          {
            id,
            order: nextOrder,
            startTime: timeSeconds,
            endTime: end,
            ...encode,
            ...defaultClipSubtitleFields,
            ...(defaultClipSyndication
              ? { syndication: JSON.parse(JSON.stringify(defaultClipSyndication)) }
              : {}),
          },
        ];
      });
      setSelectedClipId(id);
      timelineRef.current?.scrollTimeToCenter(timeSeconds);
    },
    [clipState, duration, zoomIndex, currentTime, defaultClipSyndication, defaultClipSubtitleFields],
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

  const handleRemoveClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i + 1 })));
  }, []);

  const handleSelectClip = useCallback((id: string | null) => {
    setSelectedClipId(id);
  }, []);

  const handleUpdateClipMetadata = useCallback(
    (
      clipId: string,
      patch: Pick<EditorSubClip, "title" | "description" | "posters" | "tags" | "mainCategory">,
    ) => {
      setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, ...patch } : c)));
    },
    [],
  );

  const handleUpdateClipSyndication = useCallback(
    (clipId: string, syndication: EditorClipSyndication | undefined) => {
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
    },
    [],
  );

  const handleResizeClip = useCallback(
    (id: string, newStartTime?: number, newEndTime?: number) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const start = newStartTime ?? c.startTime;
          const end = newEndTime ?? c.endTime;
          if (end <= start) return c;
          return applySubClipBoundsWithVerticalCrop(c, start, end);
        }),
      );
    },
    [],
  );

  const handleClipTimesCommitFromList = useCallback(
    (
      clipId: string,
      startTime: number,
      endTime: number,
    ): { startTime: number; endTime: number } | null => {
      if (!clipState) return null;
      const maxT = getEditorEffectiveDuration(clipState, duration);
      const r = clampClipTimeRange(startTime, endTime, maxT, FRAME_DURATION_SEC, 0);
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
    [clipState, clips, duration],
  );

  const handleCaptureClipPoster = useCallback(
    (clipId: string) => {
      const tCur = playerRef.current?.getCurrentTime() ?? currentTime;
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;
      const clamped = Math.min(Math.max(tCur, clip.startTime), clip.endTime);
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
                  { kind: "capture" as const, id, timeSeconds: clamped, orientation, capturedAt },
                ],
              }
            : c,
        ),
      );
    },
    [clips, currentTime],
  );

  const handleCapturePosterFromPlayer = useCallback(() => {
    const targetId = selectedClipId ?? (clips.length ? clips[0].id : null);
    if (!targetId) return;
    handleCaptureClipPoster(targetId);
  }, [selectedClipId, clips, handleCaptureClipPoster]);

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

  // Arrow keys: nudge playhead by one frame. Space: play/pause.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;

      if (e.key === " " || e.code === "Space") {
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (isPlaying) {
          handlePause();
        } else {
          handlePlay();
        }
        return;
      }

      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const inPlayerKeyboardSeek = target.closest("[data-editor-keyboard-seek]");
      if ((target.closest("button") || target.closest("a[href]")) && !inPlayerKeyboardSeek) {
        return;
      }
      e.preventDefault();
      const tCur = playerRef.current?.getCurrentTime() ?? currentTime;
      const dur = playerRef.current?.getDuration() ?? duration;
      const next =
        e.key === "ArrowLeft"
          ? Math.max(0, tCur - FRAME_DURATION_SEC)
          : Math.min(dur, tCur + FRAME_DURATION_SEC);
      playerRef.current?.seek(next);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [currentTime, duration, isPlaying, handlePlay, handlePause]);

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
  const [dubbingModalClipId, setDubbingModalClipId] = useState<string | null>(null);

  const subtitleGenerateModalClip = useMemo(
    () =>
      subtitleGenerateModalClipId
        ? clips.find((c) => c.id === subtitleGenerateModalClipId) ?? null
        : null,
    [clips, subtitleGenerateModalClipId],
  );
  const subtitleBurnModalClip = useMemo(
    () => (subtitleBurnModalClipId ? clips.find((c) => c.id === subtitleBurnModalClipId) ?? null : null),
    [clips, subtitleBurnModalClipId],
  );
  const dubbingModalClip = useMemo(
    () => (dubbingModalClipId ? clips.find((c) => c.id === dubbingModalClipId) ?? null : null),
    [clips, dubbingModalClipId],
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

  const handleSaveDubbing = useCallback(
    (
      clipId: string,
      payload: {
        dubbingEnabled: boolean;
        sourceLanguage: WhisperLanguageCode;
        dubbingLocales: Record<string, boolean>;
      },
    ) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== clipId) return c;
          const selected = selectedDubbingLanguageCodes(payload.dubbingLocales);
          if (!payload.dubbingEnabled || selected.length === 0) {
            return {
              ...c,
              dubbingEnabled: false,
              dubbingSourceLanguage: payload.sourceLanguage,
              dubbingLocales: payload.dubbingLocales,
            };
          }
          return {
            ...c,
            dubbingEnabled: true,
            dubbingSourceLanguage: payload.sourceLanguage,
            dubbingLocales: payload.dubbingLocales,
          };
        }),
      );
    },
    [],
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
            nextBps = [...existing, { id: crypto.randomUUID(), timeSeconds: localT, centerX }];
          }
          const normalized = normalizeVerticalCropBreakpointsForClip(
            c.endTime - c.startTime,
            nextBps,
            c.cropWindow?.centerX ?? 0.5,
          );
          return {
            ...c,
            verticalCropMode: true,
            cropWindow: { aspectRatio: "9:16" as const, centerX: normalized[0]?.centerX ?? centerX },
            verticalCropBreakpoints: normalized,
          };
        }),
      );
    },
    [selectedClipId, currentTime],
  );

  const effectiveDuration = clipState ? getEditorEffectiveDuration(clipState, duration) : 0;
  const channelId = clipState?.channelId ?? "";

  const clipStateForSpec = useMemo<EditorClipState | null>(
    () => (clipState ? { ...clipState, endTime: effectiveDuration } : null),
    [clipState, effectiveDuration],
  );

  const stateJson: EditorStateJson | null = useMemo(() => {
    if (!clipStateForSpec) return null;
    return buildEditorStateJson(clipStateForSpec, clips);
  }, [clipStateForSpec, clips]);

  const stateJsonRef = useRef<EditorStateJson | null>(null);
  stateJsonRef.current = stateJson;

  useEffect(() => {
    return installEditorConsoleTools(() => stateJsonRef.current);
  }, []);

  const handleClipStartVodEncode = useCallback(
    async (clipId: string) => {
      if (!clipStateForSpec) return;
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

      if (clipSubtitleGenerateEnabled(clip) && !clipHasSelectedSubtitleLocales(clip)) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: "Select at least one subtitle language for this clip before encoding.",
        }));
        return;
      }

      if (clipDubbingEnabled(clip) && !clipHasSelectedDubbingLocales(clip)) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: "Select at least one dubbing target language for this clip before encoding.",
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
        const spec = buildSingleClipEditorStateJson(clipStateForSpec, clip, tenant);
        await startVodJob(spec, { editorClipId: clipId });
        await refreshVodJobs();
      } catch (err) {
        setClipVodEncodeErrors((p) => ({
          ...p,
          [clipId]: httpClient.getErrorMessage(err),
        }));
      }
    },
    [clipStateForSpec, clips, refreshVodJobs, tenant],
  );

  /**
   * Encode every clip in the list (VOD source is transparent: same encode flow
   * as live2vod). Per-clip validation / errors are handled by
   * `handleClipStartVodEncode`.
   */
  const handleCreateAllClips = useCallback(async () => {
    for (const c of clips) {
      await handleClipStartVodEncode(c.id);
    }
  }, [clips, handleClipStartVodEncode]);

  const handleClipCancelVodEncode = useCallback(
    async (clipId: string) => {
      const j = pickLatestVodEncodeJobForEditorClip(vodJobsRef.current, clipId);
      if (!j || !vodJobIsActive(j.status)) return;
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

  const handleClipWidgetsChange = useCallback(
    (next: EditorClipWidget[]) => {
      if (!selectedClipId) return;
      setClips((prev) => prev.map((c) => (c.id === selectedClipId ? { ...c, widgets: next } : c)));
    },
    [selectedClipId],
  );

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

  if (!clipState) {
    return (
      <div className="flex h-full flex-col bg-primary">
        {/* Embedded as an iframe in insight: no header (title / back / separator). */}
        <main className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="text-sm text-tertiary">{t("noSource")}</p>
        </main>
      </div>
    );
  }

  const mp4Sources = assets?.mp4 ?? [];

  return (
    <div className="flex h-full flex-col bg-primary">
      {/* Embedded as an iframe in insight: no header (title / back / separator). */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* VOD clipping tool (iframe): size to content and top-align so the timeline stays visible without scrolling. */}
        <div className="flex min-h-0 shrink-0 flex-row items-start gap-1.5 overflow-hidden px-4 py-2 sm:gap-2">
          {/* Give the clips panel more room than live2vod (aside wider than the player). Scoped to this page only. */}
          <div className="flex min-h-0 min-w-0 flex-[3] basis-0 flex-col self-start">
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
              onCapturePoster={handleCapturePosterFromPlayer}
              markRangeAwaitingOut={false}
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
            {mp4Sources.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-secondary">{t("sourceMp4")}:</span>
                {mp4Sources.map((url, i) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-md border border-secondary bg-secondary px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-tertiary/50"
                  >
                    <Download01 className="size-3.5 text-fg-secondary" aria-hidden />
                    {t("download")} {mp4Sources.length > 1 ? `#${i + 1}` : ""}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          <aside className="flex min-h-0 min-w-0 flex-[4] basis-0 flex-col border-l border-secondary py-0 pl-2">
            <EditorRightPanel
              fillAvailableHeight={false}
              clipsListHeightClassName="min-h-[45vh] max-h-[65vh]"
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
              thumbnailsEnabled
              clipsEmptyHint={t("clipsEmptyHint")}
              parentWindowDurationSec={effectiveDuration}
              onClipTimesCommit={handleClipTimesCommitFromList}
              onAddVerticalClip={() => handleAddClipAtPlayhead("vertical")}
              onAddHorizontalClip={() => handleAddClipAtPlayhead("horizontal")}
              adsEnabled={false}
              vodJobs={vodJobs}
              clipVodEncodeErrors={clipVodEncodeErrors}
              onClipStartVodEncode={(clipId) => handleClipStartVodEncode(clipId)}
              onClipCancelVodEncode={handleClipCancelVodEncode}
              onSaveVerticalCropFromModal={handleSaveVerticalCropFromModal}
              onOpenClipSubtitleGenerate={
                tenantSubtitlesEnabled ? (clipId) => setSubtitleGenerateModalClipId(clipId) : undefined
              }
              onOpenClipSubtitleBurn={
                tenantSubtitlesEnabled ? (clipId) => setSubtitleBurnModalClipId(clipId) : undefined
              }
              subtitlesControlsEnabled={tenantSubtitlesEnabled}
              onOpenClipDubbing={tenantDubbingOn ? (clipId) => setDubbingModalClipId(clipId) : undefined}
              dubbingControlsEnabled={tenantDubbingOn}
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

        <section className="flex w-full min-w-0 shrink-0 flex-col border-t border-dashed border-secondary px-4 py-2">
          <EditorTimeline
            ref={timelineRef}
            durationSeconds={effectiveDuration}
            currentTimeSeconds={currentTime}
            clipUrl={clipState.clipUrl}
            channelId={channelId}
            zoomIndex={zoomIndex}
            onZoomIndexChange={setZoomIndex}
            onSeek={handleSeek}
            onTrackClick={(time) => handleSeek(time)}
            clips={clips}
            selectedClipId={selectedClipId}
            onSelectClip={handleSelectClip}
            onRemoveClip={handleRemoveClip}
            onResizeClip={handleResizeClip}
            clipStartUnixSec={clipState.startTime}
            clientTimeZone={clientTimeZone}
            onMarkIn={handleMarkIn}
            onMarkOut={handleMarkOut}
          />
        </section>

        {/* Primary action for the VOD clipping tool: send all clips to encode. */}
        <div className="flex w-full shrink-0 items-center justify-end border-t border-secondary px-4 py-3">
          <button
            type="button"
            onClick={() => void handleCreateAllClips()}
            disabled={clips.length === 0}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-brand bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-solid-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Clapperboard className="size-4" aria-hidden />
            {t("createClips")}
          </button>
        </div>
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

      {dubbingModalClip ? (
        <EditorDubbingModal
          isOpen={!!dubbingModalClipId}
          onOpenChange={(open) => {
            if (!open) setDubbingModalClipId(null);
          }}
          dubbingEnabled={clipDubbingEnabled(dubbingModalClip)}
          sourceLanguage={
            (dubbingModalClip.dubbingSourceLanguage as WhisperLanguageCode | undefined) ??
            defaultDubbingSourceLanguage(tenant)
          }
          dubbingLocales={mergeDubbingLocalesWithTenantPool(dubbingModalClip.dubbingLocales, tenant)}
          availableLanguages={
            availableDubbingLanguages.length
              ? availableDubbingLanguages
              : tenantAvailableDubbingLanguages(tenant)
          }
          onSave={(payload) => {
            handleSaveDubbing(dubbingModalClip.id, payload);
            setDubbingModalClipId(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function VodEditorPage() {
  return (
    <I18nextProvider i18n={vodEditorI18n}>
      <VodEditorInner />
    </I18nextProvider>
  );
}
