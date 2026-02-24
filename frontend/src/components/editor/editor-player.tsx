import { useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Play, PauseCircle, StopCircle, VolumeMax, VolumeX } from "@untitledui/icons";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";
import type { EditorSubClip } from "@/types/editor";

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
  /** Mark In/Out buttons at bottom center. */
  currentTimeSeconds?: number;
  markInTime?: number | null;
  selectedClip?: EditorSubClip | null;
  onMarkIn?: (timeSeconds: number) => void;
  onMarkOut?: (timeSeconds: number) => void;
  markInOutDisabled?: boolean;
}

const overlayButtonClass =
  "flex size-9 cursor-pointer items-center justify-center rounded-md bg-black/60 text-white transition-colors hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/50";

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
      currentTimeSeconds = 0,
      markInTime = null,
      selectedClip = null,
      onMarkIn,
      onMarkOut,
      markInOutDisabled,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<Player | null>(null);

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

    const canMarkIn = selectedClip
      ? currentTimeSeconds < selectedClip.endTime
      : true;
    const canMarkOut = selectedClip
      ? currentTimeSeconds > selectedClip.startTime
      : markInTime !== null && currentTimeSeconds > markInTime;
    const isMarkInRangeSelectionActive = !selectedClip && markInTime !== null;

    return (
      <div className="relative aspect-video w-full max-w-3xl overflow-hidden rounded-lg bg-black">
        <div ref={containerRef} className="video-js-container" />
        {isMarkInRangeSelectionActive && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-3 py-1.5 text-xs font-semibold text-white shadow">
            Select the time until Mark Out
          </div>
        )}
        {/* Play / Pause / Stop — bottom-left, same style as Mute */}
        {(onTransportPlay || onTransportPause || onTransportStop) && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1">
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
          </div>
        )}
        {/* Mark In / Mark Out — bottom center, same style as Play/Stop */}
        {onMarkIn && onMarkOut && (
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1">
            <button
              type="button"
              onClick={() => onMarkIn(currentTimeSeconds)}
              disabled={markInOutDisabled || !canMarkIn}
              className={`flex cursor-pointer items-center justify-center rounded-md bg-black/60 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-black/60 border-[3px] ${
                isMarkInRangeSelectionActive ? "border-blue-500" : "border-transparent"
              }`}
              title="Mark In"
              aria-label="Mark In"
            >
              Mark In
            </button>
            <button
              type="button"
              onClick={() => onMarkOut(currentTimeSeconds)}
              disabled={markInOutDisabled || !canMarkOut}
              className="flex cursor-pointer items-center justify-center rounded-md bg-black/60 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-black/60"
              title="Mark Out"
              aria-label="Mark Out"
            >
              Mark Out
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={handleMuteToggle}
          className={`absolute bottom-2 right-2 ${overlayButtonClass}`}
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
