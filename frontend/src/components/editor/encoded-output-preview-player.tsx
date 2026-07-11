import { useEffect, useRef } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";

type Props = {
  url: string;
};

function playbackMimeType(url: string): string {
  return /\.m3u8(\?|#|$)/i.test(url) ? "application/x-mpegURL" : "video/mp4";
}

/** HLS/MP4 preview for encoded clip output (native <video> cannot play HLS in most browsers). */
export function EncodedOutputPreviewPlayer({ url }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  useEffect(() => {
    if (!containerRef.current || !url) return;

    const videoEl = document.createElement("video-js");
    videoEl.classList.add("vjs-fluid");
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(videoEl);

    const player = videojs(videoEl, {
      controls: true,
      autoplay: false,
      preload: "auto",
      fluid: true,
      sources: [{ src: url, type: playbackMimeType(url) }],
    });
    playerRef.current = player;

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [url]);

  return (
    <div
      ref={containerRef}
      className="mt-3 aspect-video w-full overflow-hidden rounded-lg bg-black [&_.video-js]:h-full [&_.video-js]:w-full"
    />
  );
}
