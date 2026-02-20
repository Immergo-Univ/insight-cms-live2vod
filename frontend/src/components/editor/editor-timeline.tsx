import { useCallback, useEffect, useRef, useState } from "react";
import { Trash01 } from "@untitledui/icons";
import {
  COLUMN_WIDTH_PX,
  ZOOM_LEVELS_MS,
  ZOOM_LABELS,
  buildThumbnailUrl,
} from "./editor-constants";
import type { EditorSubClip } from "@/types/editor";

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface EditorTimelineProps {
  durationSeconds: number;
  currentTimeSeconds: number;
  clipUrl: string;
  channelId: string;
  zoomIndex: number;
  onZoomIndexChange: (index: number) => void;
  onSeek: (timeSeconds: number) => void;
  clips?: EditorSubClip[];
  onRemoveClip?: (id: string) => void;
}

export function EditorTimeline({
  durationSeconds,
  currentTimeSeconds,
  clipUrl,
  channelId,
  zoomIndex,
  onZoomIndexChange,
  onSeek,
  clips = [],
  onRemoveClip,
}: EditorTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [hoverClipId, setHoverClipId] = useState<string | null>(null);

  const zoomMs = ZOOM_LEVELS_MS[zoomIndex] ?? ZOOM_LEVELS_MS[0];
  const zoomSeconds = zoomMs / 1000;
  const columnCount = Math.max(1, Math.ceil(durationSeconds / zoomSeconds));
  const totalWidth = columnCount * COLUMN_WIDTH_PX;
  const playheadPx =
    durationSeconds > 0
      ? (currentTimeSeconds / durationSeconds) * totalWidth
      : 0;

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 1 : -1;
        const next = Math.max(0, Math.min(ZOOM_LEVELS_MS.length - 1, zoomIndex + delta));
        if (next !== zoomIndex) onZoomIndexChange(next);
      } else {
        const el = scrollRef.current;
        if (el) el.scrollLeft += e.deltaY;
      }
    },
    [zoomIndex, onZoomIndexChange]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-clip-overlay]")) return;
      const inner = innerRef.current;
      if (!inner || durationSeconds <= 0) return;
      const rect = inner.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, x / totalWidth));
      const time = fraction * durationSeconds;
      onSeek(time);
    },
    [durationSeconds, totalWidth, onSeek]
  );

  if (durationSeconds <= 0) {
    return (
      <div className="rounded-lg border border-secondary bg-secondary p-4 text-center text-sm text-tertiary">
        Timeline will appear when the clip is loaded.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-secondary">
          {formatTime(currentTimeSeconds)} / {formatTime(durationSeconds)}
        </span>
        <select
          value={zoomIndex}
          onChange={(e) => onZoomIndexChange(Number(e.target.value))}
          className="rounded border border-secondary bg-primary px-2 py-1 text-xs text-primary"
          aria-label="Timeline zoom"
        >
          {ZOOM_LABELS.map((label, i) => (
            <option key={i} value={i}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-thin relative h-[100px] overflow-x-auto overflow-y-hidden border border-secondary bg-secondary"
        onWheel={handleWheel}
        style={{ scrollBehavior: "smooth" }}
      >
        <div
          ref={innerRef}
          className="relative flex h-full cursor-pointer flex-row"
          style={{ width: totalWidth, minWidth: "100%" }}
          onClick={handleTimelineClick}
        >
          {Array.from({ length: columnCount }, (_, i) => {
            const timeSec = i * zoomSeconds;
            const thumbUrl = buildThumbnailUrl(clipUrl, timeSec, channelId);
            return (
              <div
                key={i}
                className="flex shrink-0 flex-col"
                style={{ width: COLUMN_WIDTH_PX }}
              >
                <div
                  className="h-14 w-full shrink-0 bg-quaternary"
                  style={{ width: COLUMN_WIDTH_PX }}
                >
                  <img
                    src={thumbUrl}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="flex h-6 items-center justify-center text-[10px] text-tertiary">
                  {formatTime(timeSec)}
                </div>
              </div>
            );
          })}
          {clips.map((c) => {
            const left = (c.startTime / durationSeconds) * totalWidth;
            const width = ((c.endTime - c.startTime) / durationSeconds) * totalWidth;
            const isHover = hoverClipId === c.id;
            return (
              <div
                key={c.id}
                data-clip-overlay
                className="absolute top-0 bottom-0 z-10 flex items-start justify-center border-x-2 border-brand-solid bg-brand-primary/25 transition-colors hover:bg-brand-primary/45"
                style={{
                  left,
                  width: Math.max(width, 4),
                  minWidth: 4,
                }}
                onMouseEnter={() => setHoverClipId(c.id)}
                onMouseLeave={() => setHoverClipId(null)}
              >
                {onRemoveClip && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveClip(c.id);
                    }}
                    className={`mt-1 flex size-6 items-center justify-center rounded-full bg-primary/90 text-fg-secondary shadow transition-opacity hover:bg-error-primary hover:text-white ${
                      isHover ? "opacity-100" : "opacity-0"
                    }`}
                    aria-label="Remove sub-clip"
                  >
                    <Trash01 className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-brand-solid"
            style={{
              left: playheadPx,
              transform: "translateX(-50%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
