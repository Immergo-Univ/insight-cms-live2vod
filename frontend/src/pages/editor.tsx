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
  EditorCapturePreview,
  EditorVerticalCropButton,
  EditorSubtitleButton,
} from "@/components/editor";
import { ProcessingClipsNavButton } from "@/components/live2vod/processing-clips-nav-button";
import { httpClient } from "@/services/http-client";
import { startVodJob } from "@/services/vod.service";
import {
  FRAME_DURATION_SEC,
  ZOOM_LEVELS_MS,
} from "@/components/editor/editor-constants";
import type { EditorPlayerRef } from "@/components/editor";
import { detectAds, getPrecalculatedAds } from "@/services/ads.service";
import type {
  EditorAdMarker,
  EditorClipState,
  EditorCropWindow,
  EditorVodMetadata,
  EditorPosterEntry,
  EditorStateJson,
  EditorSubClip,
  EditorSubtitleSettings,
} from "@/types/editor";
import { isValidWhisperSubtitlePair } from "@/types/editor-whisper-languages";

/** Default length for a manually inserted ad slot (seconds). */
const DEFAULT_NEW_AD_DURATION_SEC = 30;

const DEFAULT_SUBTITLE_SETTINGS: EditorSubtitleSettings = {
  whisperSourceLanguage: "auto",
  whisperOutputLanguage: "same",
  style: {
    fontSizePx: 28,
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidthPx: 3,
  },
};

/** Keep user-placed slots when precalc/detect finishes (avoids wiping manual ads). */
function mergeFetchedAdsWithManual(prev: EditorAdMarker[], fetched: EditorAdMarker[]): EditorAdMarker[] {
  const manual = prev.filter((a) => a.addedManually);
  if (manual.length === 0) {
    return fetched.map((m, i) => ({ ...m, index: i + 1 }));
  }
  const combined = [...fetched, ...manual].sort((a, b) => a.startTime - b.startTime);
  return combined.map((m, i) => ({ ...m, index: i + 1 }));
}

export function EditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
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

  const shouldSkipAdsFetchRef = useRef(!!mountSnapshot?.adsLoadComplete);

  const playerRef = useRef<EditorPlayerRef>(null);
  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(() => mountSnapshot?.fromCache === true ? mountSnapshot.zoomIndex : 1);
  const [posters, setPosters] = useState<EditorPosterEntry[]>(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.posters : [],
  );
  const [clips, setClips] = useState<EditorSubClip[]>(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.clips : [],
  );
  /** When set, Play plays only up to this time then pauses (for "play subclip"). */
  const [playUntilTime, setPlayUntilTime] = useState<number | null>(null);
  /** Subclip in "edit" mode: Mark In/Out update this clip; Play plays only this subclip. */
  const [selectedClipId, setSelectedClipId] = useState<string | null>(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.selectedClipId : null,
  );
  /** Ad slot selected on the timeline (trim handles + ring). Mutually exclusive with selectedClipId where enforced in UI. */
  const [selectedAdId, setSelectedAdId] = useState<string | null>(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.selectedAdId : null,
  );
  /** Subclip currently playing (from list row Play). Cleared on pause or when play reaches end. */
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  /** When set, we're playing the full sequence (order 1..N); value = current segment index. */
  const [playingSequenceIndex, setPlayingSequenceIndex] = useState<number | null>(null);
  const [finishLoading, setFinishLoading] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [verticalCropMode, setVerticalCropMode] = useState(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.verticalCropMode : false,
  );
  const [cropWindow, setCropWindow] = useState<EditorCropWindow | null>(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.cropWindow : null,
  );
  const [subtitleMode, setSubtitleMode] = useState(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.subtitleMode : false,
  );
  const [subtitleSettings, setSubtitleSettings] = useState<EditorSubtitleSettings>(() =>
    mountSnapshot?.fromCache === true ? mountSnapshot.subtitleSettings : DEFAULT_SUBTITLE_SETTINGS,
  );
  const [jsonPanelOpen, setJsonPanelOpen] = useState(false);
  const [vodMetadata, setVodMetadata] = useState<EditorVodMetadata>(() =>
    mountSnapshot?.fromCache === true
      ? mountSnapshot.vodMetadata
      : { title: "", description: "", tags: "" },
  );

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
      posters,
      ads,
      vodMetadata,
      verticalCropMode,
      cropWindow,
      subtitleMode,
      subtitleSettings,
      zoomIndex,
      selectedClipId,
      selectedAdId,
      adsLoadComplete,
    };
    setEditorSessionDraft(sessionKey, draft);
  }, [
    sessionKey,
    clips,
    posters,
    ads,
    vodMetadata,
    verticalCropMode,
    cropWindow,
    subtitleMode,
    subtitleSettings,
    zoomIndex,
    selectedClipId,
    selectedAdId,
    adsLoadComplete,
  ]);

  const selectionMode = clipState?.selectionMode ?? "epg";
  const isRealtime = selectionMode === "realtime";

  const [realtimeTick, setRealtimeTick] = useState(0);
  useEffect(() => {
    if (!isRealtime) return;
    const id = window.setInterval(() => setRealtimeTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isRealtime]);

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

  const sortedClips = useMemo(
    () => [...clips].sort((a, b) => a.order - b.order),
    [clips]
  );

  // Clear selection if the selected clip was removed (e.g. from timeline)
  useEffect(() => {
    if (selectedClipId && !clips.some((c) => c.id === selectedClipId)) {
      setSelectedClipId(null);
    }
  }, [selectedClipId, clips]);

  useEffect(() => {
    if (selectedAdId && !ads.some((a) => a.id === selectedAdId)) {
      setSelectedAdId(null);
    }
  }, [selectedAdId, ads]);

  // Arrow keys: move playhead by 1 frame (skip when focus is in input/textarea/select)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input") || target.closest("textarea") || target.closest("select")) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const t = playerRef.current?.getCurrentTime() ?? currentTime;
      const dur = playerRef.current?.getDuration() ?? duration;
      const next =
        e.key === "ArrowLeft"
          ? Math.max(0, t - FRAME_DURATION_SEC)
          : Math.min(dur, t + FRAME_DURATION_SEC);
      playerRef.current?.seek(next);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentTime, duration]);

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

  // When playing full sequence (1..N), jump to next subclip start at each segment end
  useEffect(() => {
    if (!isPlaying || playingSequenceIndex === null || sortedClips.length === 0) return;
    const seg = sortedClips[playingSequenceIndex];
    if (!seg) return;
    const endThreshold = seg.endTime - 0.05;
    const playerTime = playerRef.current?.getCurrentTime();
    const effectiveTime =
      typeof playerTime === "number" && !Number.isNaN(playerTime) && Math.abs(playerTime - currentTime) <= 0.25
        ? playerTime
        : currentTime;
    if (effectiveTime < endThreshold) return;
    const nextIndex = playingSequenceIndex + 1;
    if (nextIndex >= sortedClips.length) {
      playerRef.current?.pause();
      setPlayingSequenceIndex(null);
      return;
    }
    setPlayingSequenceIndex(nextIndex);
    const nextStartTime = sortedClips[nextIndex].startTime;
    playerRef.current?.seek(nextStartTime);
    setCurrentTime(nextStartTime);
    playerRef.current?.play();
  }, [isPlaying, playingSequenceIndex, currentTime, sortedClips]);

  const handlePlay = useCallback(() => {
    if (selectedClipId) {
      const clip = clips.find((c) => c.id === selectedClipId);
      if (clip) {
        setPlayUntilTime(clip.endTime);
        playerRef.current?.seek(clip.startTime);
        playerRef.current?.play();
        return;
      }
    }
    playerRef.current?.play();
  }, [selectedClipId, clips]);

  const handlePause = useCallback(() => {
    playerRef.current?.pause();
    setPlayingClipId(null);
    setPlayingSequenceIndex(null);
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
    setPlayingSequenceIndex(null);
  }, []);

  const handlePlayFullSequence = useCallback(() => {
    if (sortedClips.length === 0) return;
    setPlayingClipId(null);
    setPlayUntilTime(null);
    setPlayingSequenceIndex(0);
    playerRef.current?.seek(sortedClips[0].startTime);
    setCurrentTime(sortedClips[0].startTime);
    playerRef.current?.play();
  }, [sortedClips]);

  const handleMarkIn = useCallback(
    (timeSeconds: number) => {
      if (!clipState) return;
      setSelectedAdId(null);
      if (selectedClipId) {
        setClips((prev) =>
          prev.map((c) => {
            if (c.id !== selectedClipId) return c;
            if (timeSeconds >= c.endTime) return c;
            return { ...c, startTime: timeSeconds };
          }),
        );
        return;
      }
      const wallDuration = clipState.endTime - clipState.startTime;
      const eff = isRealtime
        ? Math.max(
            60,
            clips.length ? Math.max(...clips.map((c) => c.endTime)) : 0,
            Math.floor(Date.now() / 1000) - clipState.startTime,
          )
        : duration > 0 && Number.isFinite(duration)
          ? duration
          : wallDuration;
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
          },
        ];
      });
      setSelectedClipId(id);
    },
    [clipState, selectedClipId, isRealtime, clips, duration, zoomIndex],
  );

  const handleMarkOut = useCallback(
    (timeSeconds: number) => {
      if (!selectedClipId) return;
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== selectedClipId) return c;
          if (timeSeconds <= c.startTime) return c;
          return { ...c, endTime: timeSeconds };
        }),
      );
    },
    [selectedClipId],
  );

  const handleRealtimeRec = useCallback(() => {
    if (!clipState || clipState.selectionMode !== "realtime") return;
    const offset = Math.floor(Date.now() / 1000) - clipState.startTime;
    if (!selectedClipId) {
      handleMarkIn(offset);
    } else {
      handleMarkOut(offset);
    }
  }, [clipState, selectedClipId, handleMarkIn, handleMarkOut]);

  const handleRemoveClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleUpdateClipMetadata = useCallback(
    (
      clipId: string,
      patch: Pick<EditorSubClip, "title" | "description" | "posters">,
    ) => {
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
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
          return { ...c, startTime: start, endTime: end };
        })
      );
    },
    []
  );

  const handleOrderChange = useCallback((id: string, newOrder: number) => {
    setClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, order: newOrder } : c))
    );
  }, []);

  const handleCapturePoster = useCallback(() => {
    const t = playerRef.current?.getCurrentTime() ?? currentTime;
    const id = crypto.randomUUID();
    const capturedAt = new Date().toISOString();
    if (selectedClipId) {
      setClips((prev) =>
        prev.map((c) =>
          c.id === selectedClipId
            ? {
                ...c,
                posters: [
                  ...(c.posters ?? []),
                  {
                    kind: "capture" as const,
                    id,
                    timeSeconds: t,
                    orientation: "landscape",
                    capturedAt,
                  },
                ],
              }
            : c,
        ),
      );
      return;
    }
    setPosters((prev) => [
      ...prev,
      {
        id,
        timeSeconds: t,
        orientation: "landscape",
        capturedAt,
      },
    ]);
  }, [currentTime, selectedClipId]);

  const handleRemovePoster = useCallback((id: string) => {
    setPosters((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleSeek = useCallback((timeSeconds: number) => {
    playerRef.current?.seek(timeSeconds);
  }, []);

  const handleVerticalCropToggle = useCallback(() => {
    setVerticalCropMode((prev) => {
      if (prev) {
        setCropWindow(null);
        setJsonPanelOpen(false);
        return false;
      }
      setCropWindow({ aspectRatio: "9:16", centerX: 0.5 });
      return true;
    });
  }, []);

  const handleSubtitleToggle = useCallback(() => {
    setSubtitleMode((prev) => {
      if (prev) {
        setJsonPanelOpen(false);
        return false;
      }
      return true;
    });
  }, []);

  const handleVerticalCropCenterX = useCallback((centerX: number) => {
    setCropWindow((cw) =>
      cw ? { ...cw, centerX } : { aspectRatio: "9:16", centerX },
    );
  }, []);

  const stateJson: EditorStateJson | null = useMemo(() => {
    if (!clipState?.clipUrl) return null;
    const absEpochToIso = (absSec: number) => {
      const t = Number(absSec);
      if (!Number.isFinite(t)) return "";
      const d = new Date(t * 1000);
      return Number.isFinite(d.getTime()) ? d.toISOString() : "";
    };
    const startTime = clipState.startTime;
    const endTime =
      clipState.selectionMode === "realtime"
        ? startTime +
          Math.max(
            60,
            clips.length ? Math.max(...clips.map((c) => c.endTime)) : 0,
            Math.floor(Date.now() / 1000) - startTime,
          )
        : clipState.endTime;
    return {
      clipUrl: clipState.clipUrl,
      sourceM3u8: clipState.sourceM3u8,
      startTime,
      endTime,
      posters,
      clips: clips.map((c) => ({
        order: c.order,
        startTime: c.startTime,
        endTime: c.endTime,
        ...(c.title?.trim() ? { title: c.title.trim() } : {}),
        ...(c.description?.trim() ? { description: c.description.trim() } : {}),
        ...(c.posters?.length ? { posters: c.posters } : {}),
      })),
      ads: ads.map((a) => ({
        index: a.index,
        startTime: a.startTime,
        endTime: a.endTime,
        startProgramDateTime: absEpochToIso(startTime + a.startTime),
        endProgramDateTime: absEpochToIso(startTime + a.endTime),
      })),
      metadata: { ...vodMetadata },
      ...(verticalCropMode && cropWindow ? { cropWindow } : {}),
      ...(subtitleMode
        ? {
            subtitles: {
              enabled: true as const,
              whisperSourceLanguage: subtitleSettings.whisperSourceLanguage,
              whisperOutputLanguage: subtitleSettings.whisperOutputLanguage,
              style: { ...subtitleSettings.style },
            },
          }
        : {}),
    };
  }, [
    clipState,
    posters,
    clips,
    ads,
    vodMetadata,
    verticalCropMode,
    cropWindow,
    subtitleMode,
    subtitleSettings,
    realtimeTick,
  ]);

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

  const durationSeconds = isRealtime
    ? Math.max(
        60,
        clips.length ? Math.max(...clips.map((c) => c.endTime)) : 0,
        Math.floor(Date.now() / 1000) - clipState.startTime,
      )
    : clipState.endTime - clipState.startTime;
  const effectiveDuration = isRealtime
    ? durationSeconds
    : duration > 0 && Number.isFinite(duration)
      ? duration
      : durationSeconds;
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

  const handleFinishCreate = async (includeAds: boolean) => {
    if (clips.length === 0) {
      setFinishError("Add at least one clip before creating a VOD.");
      return;
    }
    const clipsMissingTitle = clips.filter((c) => !c.title?.trim());
    if (clipsMissingTitle.length > 0) {
      setFinishError(
        "Set a title for every clip (open the metadata control on each row in the Clips list).",
      );
      return;
    }
    if (
      subtitleMode &&
      !isValidWhisperSubtitlePair(
        subtitleSettings.whisperSourceLanguage,
        subtitleSettings.whisperOutputLanguage,
      )
    ) {
      setFinishError("Fix subtitle languages in the subtitle style dialog (invalid video vs subtitle combination).");
      return;
    }
    if (!httpClient.getTenantId()) {
      setFinishError("Missing tenantId in the URL query string.");
      return;
    }
    setFinishError(null);
    setFinishLoading(true);
    try {
      if (!stateJson) return;
      const spec = includeAds ? stateJson : { ...stateJson, ads: [] };
      await startVodJob(spec);
      navigate({ pathname: "/processing-clips", search: window.location.search });
    } catch (err) {
      setFinishError(httpClient.getErrorMessage(err));
    } finally {
      setFinishLoading(false);
    }
  };

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

      <main className="flex min-h-0 flex-1 flex-row overflow-hidden">
        {/* Left column: Player, Timeline — scroll if needed so timeline is never squashed under Preview */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-4 py-2">
          {/* 1. Video player (~2/3) + Capture & Preview (~1/3) */}
          <section className="flex shrink-0 items-start gap-3">
            <div className="min-w-0 flex-[2]">
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
                verticalCropActive={verticalCropMode}
                verticalCropCenterX={cropWindow?.centerX ?? 0.5}
                onVerticalCropCenterXChange={handleVerticalCropCenterX}
                subtitleOverlayActive={subtitleMode}
                subtitleSettings={subtitleSettings}
                onSubtitleSettingsChange={setSubtitleSettings}
              />
            </div>
            <div className="min-h-0 min-w-0 flex-1 basis-0">
              <EditorCapturePreview
                posters={posters}
                currentTimeSeconds={currentTime}
                onCapture={handleCapturePoster}
                onRemovePoster={handleRemovePoster}
                onSeek={handleSeek}
                getVideoElement={() => playerRef.current?.getVideoElement() ?? null}
              />
            </div>
          </section>

          {/* 2. Timeline + Zoom — natural height (no flex-1) so Mark In/Out never stacks under Preview */}
          <section className="flex w-full min-w-0 shrink-0 flex-col">
            {isRealtime ? (
              <EditorRealtimeRecBar
                clips={clips}
                selectedClipId={selectedClipId}
                onRecPress={handleRealtimeRec}
                timeZone={clientTimeZone}
                clockTick={realtimeTick}
              />
            ) : (
              <EditorTimeline
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
        </div>

        {/* Right column: session summary, metadata modal, clips list */}
        <aside className="flex min-h-0 w-80 shrink-0 flex-col border-l border-secondary py-2 pr-4 pl-2">
          <EditorRightPanel
            channelTitle={clipState.channelTitle ?? ""}
            selectionMode={selectionMode}
            windowStartUnixSec={clipState.startTime}
            windowEndUnixSec={clipState.endTime}
            timelineDurationSec={durationSeconds}
            timeZone={clientTimeZone}
            metadata={vodMetadata}
            onMetadataChange={setVodMetadata}
            clips={clips}
            clipUrl={clipState.clipUrl}
            channelId={channelId}
            selectedClipId={selectedClipId}
            onSelectClip={handleSelectClip}
            playingClipId={playingClipId}
            isPlaying={isPlaying}
            onPlaySubclip={handlePlaySubclip}
            onPause={handlePause}
            onOrderChange={handleOrderChange}
            onRemoveClip={handleRemoveClip}
            onUpdateClipMetadata={handleUpdateClipMetadata}
            onSeek={handleSeek}
            onPlayFullSequence={handlePlayFullSequence}
            thumbnailsEnabled={!isRealtime}
            clipsEmptyHint={
              isRealtime
                ? "Use REC to add Mark In / Mark Out segments."
                : "Use Mark In / Mark Out to add ranges."
            }
            realtimeWallClock={
              isRealtime
                ? {
                    sessionStartUnixSec: clipState.startTime,
                    timeZone: clientTimeZone,
                  }
                : undefined
            }
            onAddAdSlot={handleAddAdSlot}
            addAdSlotDisabled={isRealtime}
            onCreateWithoutAds={() => void handleFinishCreate(false)}
            onCreateWithAds={() => void handleFinishCreate(true)}
            finishLoading={finishLoading}
            finishError={finishError}
            ads={ads}
            selectedAdId={selectedAdId}
            onSelectAd={handleSelectAd}
            onRemoveAd={handleRemoveAd}
            onAdOrderChange={handleAdOrderChange}
          />
        </aside>
      </main>

      {/* Footer: Back (left), tools (right) */}
      <footer className="flex shrink-0 items-center justify-between border-t border-secondary px-4 py-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
          >
            Back
          </button>
        </div>
        <div className="flex items-center gap-2">
          <ProcessingClipsNavButton />
          <EditorVerticalCropButton
            active={verticalCropMode}
            onToggle={handleVerticalCropToggle}
          />
          <EditorSubtitleButton active={subtitleMode} onToggle={handleSubtitleToggle} />
          <EditorJsonButton
            stateJson={stateJson}
            open={jsonPanelOpen}
            onOpenChange={setJsonPanelOpen}
          />
        </div>
      </footer>
    </div>
  );
}
