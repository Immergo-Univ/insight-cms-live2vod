import { useEffect, useRef, useMemo } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";

export interface TimeWindow {
  startTime: number;
  endTime: number;
}

interface VideoPreviewProps {
  streamUrl: string;
  timeWindow: TimeWindow;
}

function buildStreamUrl(baseUrl: string, tw: TimeWindow): string {
  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set("startTime", String(Math.floor(tw.startTime)));
  url.searchParams.set("endTime", String(Math.floor(tw.endTime)));
  return url.toString();
}

export function VideoPreview({ streamUrl, timeWindow }: VideoPreviewProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  const src = useMemo(
    () => buildStreamUrl(streamUrl, timeWindow),
    [streamUrl, timeWindow.startTime, timeWindow.endTime],
  );

  useEffect(() => {
    if (!videoRef.current) return;

    const videoEl = document.createElement("video-js");
    videoEl.classList.add("vjs-big-play-centered", "vjs-fluid");
    videoRef.current.appendChild(videoEl);

    const player = videojs(videoEl, {
      controls: true,
      autoplay: false,
      preload: "auto",
      fluid: true,
      responsive: true,
      sources: [{ src, type: "application/x-mpegURL" }],
    });

    playerRef.current = player;

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
    // Only create/destroy on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    player.src({ src, type: "application/x-mpegURL" });
  }, [src]);

  return <div ref={videoRef} />;
}
