import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
} from "react";
import { Play, PauseCircle, StopCircle, VolumeMax, VolumeX } from "@untitledui/icons";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";
import type { EditorClipWidget, EditorSubtitleSettings } from "@/types/editor";
import {
  computeVideoContentRect,
  EditorVerticalCropOverlay,
  type VideoContentRect,
} from "./editor-vertical-crop-overlay";
import { EditorSubtitleOverlay } from "./editor-subtitle-overlay";
import { EditorClipWidgetsOverlay } from "./editor-clip-widgets-overlay";
import { computeWidgetViewportRect } from "./editor-widget-viewport";

export interface EditorPlayerRef {
  seek: (timeSeconds: number) => void;
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  /** Raw video element for canvas capture (e.g. Mark In/Out preview). */
  getVideoElement: () => HTMLVideoElement | null;
}

interface EditorPlayerProps {
  clipUrl: string;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  onTimeUpdate?: (timeSeconds: number) => void;
  onDurationChange?: (durationSeconds: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  /** Transport controls shown over the player (same style as Mute). */
  isPlaying?: boolean;
  onTransportPlay?: () => void;
  onTransportPause?: () => void;
  onTransportStop?: () => void;
  /** True after Mark In (no clip selected): show hint until Mark Out. */
  markRangeAwaitingOut?: boolean;
  /** Realtime editor: show pulsing on-screen REC while a clip is open for Mark Out. */
  realtimeRecordingActive?: boolean;
  /** 9:16 vertical crop preview over the wide frame. */
  verticalCropActive?: boolean;
  verticalCropCenterX?: number;
  onVerticalCropCenterXChange?: (centerX: number) => void;
  /** Burned-in subtitle preview (example text) over the picture. */
  subtitleOverlayActive?: boolean;
  subtitleSettings?: EditorSubtitleSettings;
  onSubtitleSettingsChange?: (next: EditorSubtitleSettings) => void;
  /** Per-clip overlay widgets (text / image); positions are relative to the widget viewport (full frame or 9:16 strip). */
  clipWidgets?: EditorClipWidget[];
  onClipWidgetsChange?: (next: EditorClipWidget[]) => void;
  /** Select this widget id in the overlay once it appears in `clipWidgets` (e.g. after adding a text widget). */
  clipWidgetFocusRequestId?: string | null;
  onClipWidgetFocusRequestHandled?: () => void;
  /** Parent-window times for the selected sub-clip + playhead (widget offset preview / edit limits). */
  clipWidgetTimelineContext?: {
    clipStartSec: number;
    clipEndSec: number;
    playheadSec: number;
  } | null;
}

const overlayButtonClass =
  "flex size-9 cursor-pointer items-center justify-center rounded-md bg-black/60 text-white transition-colors hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/50";

const EDITOR_PREVIEW_PLAYBACK_RATES = [0.5, 1, 1.5, 2, 3] as const;

function formatPlaybackRateShort(rate: number): string {
  return `${rate}x`;
}

export const EditorPlayer = forwardRef<EditorPlayerRef, EditorPlayerProps>(
  function EditorPlayer(
    {
      clipUrl,
      muted = false,
      onMutedChange,
      onTimeUpdate,
      onDurationChange,
      onPlay,
      onPause,
      isPlaying = false,
      onTransportPlay,
      onTransportPause,
      onTransportStop,
      markRangeAwaitingOut = false,
      realtimeRecordingActive = false,
      verticalCropActive = false,
      verticalCropCenterX = 0.5,
      onVerticalCropCenterXChange,
      subtitleOverlayActive = false,
      subtitleSettings,
      onSubtitleSettingsChange,
      clipWidgets = [],
      onClipWidgetsChange,
      clipWidgetFocusRequestId = null,
      onClipWidgetFocusRequestHandled,
      clipWidgetTimelineContext = null,
    },
    ref
  ) {
    const outerRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<Player | null>(null);
    const speedMenuRef = useRef<HTMLDivElement>(null);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
    const playbackRateRef = useRef(playbackRate);
    playbackRateRef.current = playbackRate;
    const [contentRect, setContentRect] = useState<VideoContentRect>({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });

    const updateContentRect = useCallback(() => {
      const outer = outerRef.current;
      const video = containerRef.current?.querySelector("video") ?? null;
      if (!outer) return;
      setContentRect(computeVideoContentRect(outer, video));
    }, []);

    const updateContentRectRef = useRef(updateContentRect);
    updateContentRectRef.current = updateContentRect;

    useEffect(() => {
      if (!speedMenuOpen) return;
      const onDocPointerDown = (e: PointerEvent) => {
        const el = speedMenuRef.current;
        if (el && !el.contains(e.target as Node)) setSpeedMenuOpen(false);
      };
      document.addEventListener("pointerdown", onDocPointerDown);
      return () => document.removeEventListener("pointerdown", onDocPointerDown);
    }, [speedMenuOpen]);

    useEffect(() => {
      const player = playerRef.current;
      if (!player) return;
      player.playbackRate(playbackRate);
    }, [playbackRate]);

    const hasWidgets = (clipWidgets?.length ?? 0) > 0;
    const measureOverlays = verticalCropActive || subtitleOverlayActive || hasWidgets;

    useLayoutEffect(() => {
      if (!measureOverlays) return;
      updateContentRect();
    }, [measureOverlays, clipUrl, updateContentRect]);

    useEffect(() => {
      if (!measureOverlays) return;
      const outer = outerRef.current;
      const container = containerRef.current;
      if (!outer || !container) return;

      const ro = new ResizeObserver(() => updateContentRect());
      ro.observe(outer);

      let detachVideo: (() => void) | undefined;
      const bindVideo = () => {
        detachVideo?.();
        const v = container.querySelector("video");
        if (!v) return;
        const onMeta = () => updateContentRect();
        v.addEventListener("loadedmetadata", onMeta);
        detachVideo = () => v.removeEventListener("loadedmetadata", onMeta);
      };

      bindVideo();
      updateContentRect();

      const mo = new MutationObserver(() => {
        bindVideo();
        updateContentRect();
      });
      mo.observe(container, { childList: true, subtree: true });

      return () => {
        ro.disconnect();
        mo.disconnect();
        detachVideo?.();
      };
    }, [measureOverlays, clipUrl, updateContentRect]);

    useEffect(() => {
      if (!containerRef.current) return;

      const videoEl = document.createElement("video-js");
      videoEl.classList.add("vjs-fluid");
      videoEl.setAttribute("data-setup", "{}");
      containerRef.current.appendChild(videoEl);

      const player = videojs(videoEl, {
        controls: false,
        autoplay: false,
        preload: "auto",
        fluid: true,
        bigPlayButton: false,
        sources: [{ src: clipUrl, type: "application/x-mpegURL" }],
      });

      playerRef.current = player;

      player.ready(() => {
        updateContentRectRef.current();
        player.playbackRate(playbackRateRef.current);
      });

      const onTimeUpdateHandler = () => {
        const t = player.currentTime();
        if (typeof t === "number" && !Number.isNaN(t)) onTimeUpdate?.(t);
      };
      const onDurationChangeHandler = () => {
        const d = player.duration();
        if (typeof d === "number" && !Number.isNaN(d)) onDurationChange?.(d);
      };

      player.on("timeupdate", onTimeUpdateHandler);
      player.on("durationchange", onDurationChangeHandler);
      player.on("play", () => onPlay?.());
      player.on("pause", () => onPause?.());

      return () => {
        player.off("timeupdate", onTimeUpdateHandler);
        player.off("durationchange", onDurationChangeHandler);
        player.dispose();
        playerRef.current = null;
      };
    }, [clipUrl]);

    const widgetViewport = computeWidgetViewportRect(
      contentRect,
      verticalCropActive,
      verticalCropCenterX,
    );

    useEffect(() => {
      const player = playerRef.current;
      if (!player) return;
      player.muted(muted);
    }, [muted]);

    useImperativeHandle(
      ref,
      () => ({
        seek(timeSeconds: number) {
          playerRef.current?.currentTime(timeSeconds);
        },
        play() {
          playerRef.current?.play();
        },
        pause() {
          playerRef.current?.pause();
        },
        getCurrentTime() {
          const t = playerRef.current?.currentTime();
          return typeof t === "number" && !Number.isNaN(t) ? t : 0;
        },
        getDuration() {
          const d = playerRef.current?.duration();
          return typeof d === "number" && !Number.isNaN(d) ? d : 0;
        },
        getVideoElement() {
          return containerRef.current?.querySelector("video") ?? null;
        },
      }),
      []
    );

    const handleMuteToggle = useCallback(() => {
      onMutedChange?.(!muted);
    }, [muted, onMutedChange]);

    return (
      <div
        ref={outerRef}
        className="relative aspect-video w-full max-w-full overflow-hidden rounded-lg bg-black"
      >
        <div ref={containerRef} className="video-js-container" />
        {verticalCropActive && onVerticalCropCenterXChange ? (
          <EditorVerticalCropOverlay
            contentRect={contentRect}
            centerX={verticalCropCenterX}
            onCenterXChange={onVerticalCropCenterXChange}
          />
        ) : null}
        {subtitleOverlayActive && subtitleSettings && onSubtitleSettingsChange ? (
          <EditorSubtitleOverlay
            contentRect={contentRect}
            settings={subtitleSettings}
            onSettingsChange={onSubtitleSettingsChange}
          />
        ) : null}
        {hasWidgets && onClipWidgetsChange ? (
          <EditorClipWidgetsOverlay
            viewport={widgetViewport}
            widgets={clipWidgets}
            onWidgetsChange={onClipWidgetsChange}
            focusWidgetIdRequest={clipWidgetFocusRequestId}
            onFocusWidgetRequestHandled={onClipWidgetFocusRequestHandled}
            timelineContext={clipWidgetTimelineContext}
          />
        ) : null}
        {realtimeRecordingActive ? (
          <div
            className="pointer-events-none absolute top-3 left-3 z-30 flex items-center gap-2 rounded-md border border-red-500/40 bg-black/60 px-3 py-2 shadow-lg"
            role="status"
            aria-live="polite"
            aria-label="Recording"
          >
            <span
              className="size-3 shrink-0 rounded-full bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.9)] motion-safe:animate-pulse"
              aria-hidden
            />
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-red-500 motion-safe:animate-pulse">
              REC
            </span>
          </div>
        ) : markRangeAwaitingOut ? (
          <div className="pointer-events-none absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-md bg-black/60 px-3 py-1.5 text-xs font-semibold text-white shadow">
            Select the time until Mark Out
          </div>
        ) : null}
        {/* Play / Pause / Stop — bottom-left, same style as Mute */}
        {(onTransportPlay || onTransportPause || onTransportStop) && (
          <div
            className="absolute bottom-2 left-2 z-20 flex items-center gap-1"
            data-editor-keyboard-seek
          >
            {isPlaying ? (
              <button
                type="button"
                onClick={onTransportPause}
                className={overlayButtonClass}
                title="Pause"
                aria-label="Pause"
              >
                <PauseCircle className="size-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onTransportPlay}
                className={overlayButtonClass}
                title="Play"
                aria-label="Play"
              >
                <Play className="size-5" />
              </button>
            )}
            <button
              type="button"
              onClick={onTransportStop}
              className={overlayButtonClass}
              title="Stop"
              aria-label="Stop"
            >
              <StopCircle className="size-5" />
            </button>
            <div ref={speedMenuRef} className="relative">
              <button
                type="button"
                data-editor-keyboard-seek
                aria-haspopup="listbox"
                aria-expanded={speedMenuOpen}
                aria-label={`Playback speed, currently ${formatPlaybackRateShort(playbackRate)}`}
                title="Playback speed"
                onClick={() => setSpeedMenuOpen((open) => !open)}
                className={`${overlayButtonClass} min-w-11 px-1.5 text-xs font-semibold tabular-nums`}
              >
                {formatPlaybackRateShort(playbackRate)}
              </button>
              {speedMenuOpen ? (
                <div
                  role="listbox"
                  aria-label="Playback speed"
                  className="absolute bottom-full left-0 z-30 mb-1 flex min-w-[5.5rem] flex-col gap-0.5 rounded-md border border-white/15 bg-black/90 p-1 shadow-lg"
                >
                  {EDITOR_PREVIEW_PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      role="option"
                      aria-selected={rate === playbackRate}
                      data-editor-keyboard-seek
                      className={`rounded px-2 py-1.5 text-left text-xs font-semibold tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 ${
                        rate === playbackRate
                          ? "bg-white/20 text-white"
                          : "text-white/90 hover:bg-white/10"
                      }`}
                      onClick={() => {
                        setPlaybackRate(rate);
                        setSpeedMenuOpen(false);
                      }}
                    >
                      {formatPlaybackRateShort(rate)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}
        <button
          type="button"
          data-editor-keyboard-seek
          onClick={handleMuteToggle}
          className={`absolute bottom-2 right-2 z-20 ${overlayButtonClass}`}
          title={muted ? "Unmute" : "Mute"}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? (
            <VolumeX className="size-5" />
          ) : (
            <VolumeMax className="size-5" />
          )}
        </button>
      </div>
    );
  }
);
