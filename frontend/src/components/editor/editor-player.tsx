import { useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { VolumeMax, VolumeX } from "@untitledui/icons";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";

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
}

export const EditorPlayer = forwardRef<EditorPlayerRef, EditorPlayerProps>(
  function EditorPlayer(
    { clipUrl, muted = false, onMutedChange, onTimeUpdate, onDurationChange, onPlay, onPause },
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

    return (
      <div className="relative aspect-video w-full max-w-3xl overflow-hidden rounded-lg bg-black">
        <div ref={containerRef} className="video-js-container" />
        <button
          type="button"
          onClick={handleMuteToggle}
          className="absolute bottom-2 right-2 flex size-9 items-center justify-center rounded-md bg-black/60 text-white transition-colors hover:bg-black/80"
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
