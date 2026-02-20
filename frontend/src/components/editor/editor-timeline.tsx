import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Trash01 } from "@untitledui/icons";
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
  /** Called when the track background is clicked (not on a clip). Use to seek and e.g. clear selection. */
  onTrackClick?: (timeSeconds: number) => void;
  clips?: EditorSubClip[];
  selectedClipId?: string | null;
  onSelectClip?: (id: string | null) => void;
  onRemoveClip?: (id: string) => void;
  onResizeClip?: (id: string, newStartTime?: number, newEndTime?: number) => void;
}

export function EditorTimeline({
  durationSeconds,
  currentTimeSeconds,
  clipUrl,
  channelId,
  zoomIndex,
  onZoomIndexChange,
  onSeek,
  onTrackClick,
  clips = [],
  selectedClipId = null,
  onSelectClip,
  onRemoveClip,
  onResizeClip,
}: EditorTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [hoverClipId, setHoverClipId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    clipId: string;
    edge: "left" | "right";
    startTime: number;
    endTime: number;
  } | null>(null);

  const zoomMs = ZOOM_LEVELS_MS[zoomIndex] ?? ZOOM_LEVELS_MS[0];
  const zoomSeconds = zoomMs / 1000;
  const columnCount = Math.max(1, Math.ceil(durationSeconds / zoomSeconds));
  const totalWidth = columnCount * COLUMN_WIDTH_PX;

  const pixelToTime = useCallback(
    (clientX: number) => {
      const inner = innerRef.current;
      if (!inner || durationSeconds <= 0) return 0;
      const cols = Math.max(1, Math.ceil(durationSeconds / zoomSeconds));
      const width = cols * COLUMN_WIDTH_PX;
      const rect = inner.getBoundingClientRect();
      const x = clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, width > 0 ? x / width : 0));
      return fraction * durationSeconds;
    },
    [durationSeconds, zoomSeconds]
  );

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
        if (el) el.scrollLeft += e.deltaY * 2;
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

  const scrollStep = 400;

  const handleScrollLeft = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: -scrollStep, behavior: "smooth" });
  }, []);

  const handleScrollRight = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: scrollStep, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!dragging || !onResizeClip) return;
    const minDuration = 1;

    const onMouseMove = (e: MouseEvent) => {
      const t = pixelToTime(e.clientX);
      if (dragging.edge === "left") {
        const newStart = Math.max(0, Math.min(t, dragging.endTime - minDuration));
        onResizeClip(dragging.clipId, newStart, undefined);
      } else {
        const newEnd = Math.max(dragging.startTime + minDuration, Math.min(durationSeconds, t));
        onResizeClip(dragging.clipId, undefined, newEnd);
      }
    };
    const onMouseUp = () => setDragging(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, durationSeconds, onResizeClip, pixelToTime]);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-clip-overlay]") || target.closest("[data-resize-handle]")) return;
      const inner = innerRef.current;
      if (!inner || durationSeconds <= 0) return;
      const cols = Math.max(1, Math.ceil(durationSeconds / zoomSeconds));
      const width = cols * COLUMN_WIDTH_PX;
      const rect = inner.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, width > 0 ? x / width : 0));
      const time = fraction * durationSeconds;
      if (onTrackClick) onTrackClick(time);
      else onSeek(time);
    },
    [durationSeconds, zoomSeconds, onSeek, onTrackClick]
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
      <div className="flex items-stretch gap-0">
        <button
          type="button"
          onClick={handleScrollLeft}
          className="flex shrink-0 items-center justify-center border border-secondary border-r-0 bg-secondary px-2 text-fg-secondary transition-colors hover:bg-tertiary hover:text-fg-primary"
          aria-label="Scroll timeline left"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div
          ref={scrollRef}
          className="scrollbar-hide relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden border border-secondary bg-secondary"
          style={{ height: 120, scrollBehavior: "smooth" }}
          onWheel={handleWheel}
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
                    className="min-h-0 flex-1 w-full bg-quaternary"
                    style={{ width: COLUMN_WIDTH_PX }}
                  >
                    <img
                      src={thumbUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex h-6 shrink-0 items-center justify-center text-[10px] text-tertiary">
                    {formatTime(timeSec)}
                  </div>
                </div>
              );
            })}
          {clips.map((c) => {
            const left = (c.startTime / durationSeconds) * totalWidth;
            const width = ((c.endTime - c.startTime) / durationSeconds) * totalWidth;
            const isHover = hoverClipId === c.id;
            const isSelected = selectedClipId === c.id;
            const canResize = onResizeClip && width > 8;
            const handleOverlayClick = () => {
              if (onSelectClip) {
                onSelectClip(isSelected ? null : c.id);
                if (!isSelected) onSeek(c.startTime);
              }
            };
            return (
              <div
                key={c.id}
                data-clip-overlay
                role={onSelectClip ? "button" : undefined}
                tabIndex={onSelectClip ? 0 : undefined}
                onClick={onSelectClip ? handleOverlayClick : undefined}
                onKeyDown={
                  onSelectClip
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleOverlayClick();
                        }
                      }
                    : undefined
                }
                className={`absolute top-0 bottom-0 z-10 flex items-start justify-center transition-colors ${
                  isSelected
                    ? "ring-2 ring-brand-solid bg-blue-500/50"
                    : "bg-blue-500/30 hover:bg-blue-500/50"
                }`}
                style={{
                  left,
                  width: Math.max(width, 4),
                  minWidth: 4,
                }}
                onMouseEnter={() => setHoverClipId(c.id)}
                onMouseLeave={() => setHoverClipId(null)}
              >
                {canResize && (
                  <>
                    <div
                      data-resize-handle
                      className="absolute left-0 top-0 z-30 h-full w-0.5 cursor-ew-resize bg-blue-600 transition-[width] duration-100 hover:w-1"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragging({ clipId: c.id, edge: "left", startTime: c.startTime, endTime: c.endTime });
                      }}
                      aria-label="Resize sub-clip start"
                    />
                    <div
                      data-resize-handle
                      className="absolute right-0 top-0 z-30 h-full w-0.5 cursor-ew-resize bg-blue-600 transition-[width] duration-100 hover:w-1"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragging({ clipId: c.id, edge: "right", startTime: c.startTime, endTime: c.endTime });
                      }}
                      aria-label="Resize sub-clip end"
                    />
                  </>
                )}
                {onRemoveClip && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveClip(c.id);
                    }}
                    className={`mt-1 flex size-6 items-center justify-center rounded-full bg-primary shadow text-fg-secondary ${
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
            className="pointer-events-none absolute top-0 bottom-0 z-20 flex flex-col items-center"
            style={{
              left: playheadPx,
              transform: "translateX(-50%)",
            }}
          >
            <div
              className="border-x-[5px] border-t-[6px] border-x-transparent border-t-red-500"
              style={{ width: 0, height: 0 }}
              aria-hidden
            />
            <div className="w-0.5 flex-1 shrink-0 bg-red-500" />
            <div
              className="border-x-[5px] border-b-[6px] border-x-transparent border-b-red-500"
              style={{ width: 0, height: 0 }}
              aria-hidden
            />
          </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleScrollRight}
          className="flex shrink-0 items-center justify-center border border-secondary border-l-0 bg-secondary px-2 text-fg-secondary transition-colors hover:bg-tertiary hover:text-fg-primary"
          aria-label="Scroll timeline right"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
    </div>
  );
}
