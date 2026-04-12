import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronLeft, ChevronRight, Trash01 } from "@untitledui/icons";
import { useDateFormatter } from "react-aria";
import {
  COLUMN_WIDTH_PX,
  ZOOM_LEVELS_MS,
  ZOOM_LABELS,
  buildThumbnailUrl,
} from "./editor-constants";
import type { EditorAdMarker, EditorSubClip } from "@/types/editor";
import { EditorMarkInOut } from "./editor-mark-in-out";
import { cx } from "@/utils/cx";

const TIMELINE_SCRUB_HEIGHT_PX = 24;
const TIMELINE_FILMSTRIP_HEIGHT_PX = 120;
const TIMELINE_RAIL_HEIGHT_PX = 10;

/** Pixels before a clip body mousedown counts as a horizontal move (vs click). */
const CLIP_BODY_DRAG_THRESHOLD_PX = 4;

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Wide hit target + NLE-style vertical trim grip (in/out brackets on the filmstrip). */
function ClipFilmstripTrimHandle({
  edge,
  onMouseDown,
  ariaLabel,
  variant = "clip",
}: {
  edge: "left" | "right";
  onMouseDown: (e: ReactMouseEvent) => void;
  ariaLabel: string;
  /** "ad" = subtle rose/red bracket for ad slots (same shape as clip handles). */
  variant?: "clip" | "ad";
}) {
  const position =
    edge === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2";

  const isAd = variant === "ad";

  return (
    <div
      data-resize-handle
      className={cx(
        "group absolute top-0 z-30 flex h-full w-9 cursor-ew-resize touch-none select-none items-stretch justify-center",
        position,
      )}
      onMouseDown={onMouseDown}
      aria-label={ariaLabel}
    >
      <div
        className={cx(
          "pointer-events-none relative flex h-full min-h-0 w-[18px] shrink-0 flex-col items-center justify-center self-stretch",
          isAd
            ? [
                "bg-[#fecdd3]",
                "border-2 border-[#e11d48]/85",
                "shadow-[0_2px_10px_rgba(225,29,72,0.22),inset_0_1px_0_rgba(255,255,255,0.55)]",
                "dark:bg-[#9f1239]/90",
                "dark:border-[#fb7185]/75",
                "dark:shadow-[0_2px_12px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.12)]",
                "before:pointer-events-none before:absolute before:inset-y-1 before:left-px before:w-0.5 before:rounded-full before:bg-white/35",
                "after:pointer-events-none after:absolute after:inset-y-1 after:right-px after:w-px after:rounded-full after:bg-rose-950/15",
                "group-hover:brightness-[1.03] group-hover:shadow-[0_3px_14px_rgba(225,29,72,0.28),inset_0_1px_0_rgba(255,255,255,0.65)]",
                "dark:group-hover:shadow-[0_3px_16px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.16)]",
              ]
            : [
                "bg-[#4b5563]",
                "border-2 border-[#374151]",
                "shadow-[0_3px_12px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.18)]",
                "dark:shadow-[0_4px_16px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]",
                "before:pointer-events-none before:absolute before:inset-y-1 before:left-px before:w-0.5 before:rounded-full before:bg-white/18",
                "after:pointer-events-none after:absolute after:inset-y-1 after:right-px after:w-px after:rounded-full after:bg-black/20",
                "group-hover:brightness-110 group-hover:shadow-[0_4px_16px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.22)]",
                "dark:group-hover:shadow-[0_5px_20px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.14)]",
              ],
          "transition-[transform,filter] duration-100 ease-out",
          "group-active:scale-[0.97]",
          edge === "left"
            ? "rounded-bl-md rounded-br-sm rounded-tl-md rounded-tr-sm"
            : "rounded-bl-sm rounded-br-md rounded-tl-sm rounded-tr-md",
        )}
        style={{
          clipPath:
            edge === "left"
              ? "polygon(0% 5%, 18% 0%, 100% 0%, 100% 100%, 18% 100%, 0% 95%)"
              : "polygon(0% 0%, 82% 0%, 100% 5%, 100% 95%, 82% 100%, 0% 100%)",
        }}
        aria-hidden
      >
        <div className="relative z-[1] flex flex-col gap-[3px] py-2">
          <span
            className={cx(
              "h-[2px] w-[11px] rounded-[1px] shadow-[0_1px_0_rgba(0,0,0,0.2)]",
              isAd
                ? "bg-white/55 shadow-[0_1px_0_rgba(190,18,60,0.35)] dark:bg-white/40 dark:shadow-[0_1px_0_rgba(0,0,0,0.35)]"
                : "bg-white/45 shadow-[0_1px_0_rgba(0,0,0,0.35)]",
            )}
          />
          <span
            className={cx(
              "h-[2px] w-[11px] rounded-[1px] shadow-[0_1px_0_rgba(0,0,0,0.2)]",
              isAd
                ? "bg-white/55 shadow-[0_1px_0_rgba(190,18,60,0.35)] dark:bg-white/40 dark:shadow-[0_1px_0_rgba(0,0,0,0.35)]"
                : "bg-white/45 shadow-[0_1px_0_rgba(0,0,0,0.35)]",
            )}
          />
          <span
            className={cx(
              "h-[2px] w-[11px] rounded-[1px] shadow-[0_1px_0_rgba(0,0,0,0.2)]",
              isAd
                ? "bg-white/55 shadow-[0_1px_0_rgba(190,18,60,0.35)] dark:bg-white/40 dark:shadow-[0_1px_0_rgba(0,0,0,0.35)]"
                : "bg-white/45 shadow-[0_1px_0_rgba(0,0,0,0.35)]",
            )}
          />
        </div>
      </div>
    </div>
  );
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
  ads?: EditorAdMarker[];
  adsLoading?: boolean;
  onRemoveAd?: (id: string) => void;
  onResizeAd?: (id: string, newStartTime?: number, newEndTime?: number) => void;
  selectedAdId?: string | null;
  onSelectAd?: (id: string | null) => void;
  /** Unix seconds when the clip window starts (wall clock = this + playhead offset). */
  clipStartUnixSec?: number;
  /** IANA timezone (e.g. from ?tz= query). */
  clientTimeZone?: string;
  /** Mark In / Out (shown in the row under the player, next to time / ads). */
  onMarkIn?: (timeSeconds: number) => void;
  onMarkOut?: (timeSeconds: number) => void;
  markInOutDisabled?: boolean;
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
  ads = [],
  adsLoading = false,
  onRemoveAd,
  onResizeAd,
  selectedAdId = null,
  onSelectAd,
  clipStartUnixSec = 0,
  clientTimeZone,
  onMarkIn,
  onMarkOut,
  markInOutDisabled,
}: EditorTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Thin horizontal scrollbar below thumbnails, synced with scrollRef */
  const railRef = useRef<HTMLDivElement>(null);
  const prevZoomIndexRef = useRef<number | null>(null);
  const playheadTimeForZoomRef = useRef(currentTimeSeconds);
  playheadTimeForZoomRef.current = currentTimeSeconds;
  /** Full-width track (scrub strip + filmstrip) for time ↔ x mapping */
  const trackRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scrubHoverX, setScrubHoverX] = useState<number | null>(null);
  const [hoverClipId, setHoverClipId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    clipId: string;
    edge: "left" | "right";
    startTime: number;
    endTime: number;
  } | null>(null);
  const [hoverAdId, setHoverAdId] = useState<string | null>(null);
  const [adDragging, setAdDragging] = useState<{
    adId: string;
    edge: "left" | "right";
    startTime: number;
    endTime: number;
  } | null>(null);

  type ClipBodyDragSession = {
    clipId: string;
    startTime: number;
    endTime: number;
    lastClientX: number;
    activated: boolean;
  };
  const [clipBodyDrag, setClipBodyDrag] = useState<ClipBodyDragSession | null>(null);
  const clipBodyDragRef = useRef<ClipBodyDragSession | null>(null);
  /** True after a clip-body drag moved the range (suppresses click toggle). */
  const clipBodyDragMovedRef = useRef(false);

  type AdBodyDragSession = {
    adId: string;
    startTime: number;
    endTime: number;
    lastClientX: number;
    activated: boolean;
  };
  const [adBodyDrag, setAdBodyDrag] = useState<AdBodyDragSession | null>(null);
  const adBodyDragRef = useRef<AdBodyDragSession | null>(null);
  const adBodyDragMovedRef = useRef(false);

  const zoomMs = ZOOM_LEVELS_MS[zoomIndex] ?? ZOOM_LEVELS_MS[0];
  const zoomSeconds = zoomMs / 1000;
  /**
   * Fixed px per second so playhead, scrub, ads, and thumbnails share one linear time axis.
   * Previously each column was COLUMN_WIDTH_PX wide while the last column covered less than
   * zoomSeconds of media — linear playhead mapping then drifted from thumbnail sample times.
   */
  const pixelsPerSecond = COLUMN_WIDTH_PX / zoomSeconds;
  const timelineSegments = useMemo(() => {
    const segs: { startTime: number; widthPx: number }[] = [];
    if (durationSeconds <= 0 || zoomSeconds <= 0) return segs;
    for (let i = 0; ; i++) {
      const startTime = i * zoomSeconds;
      if (startTime >= durationSeconds) break;
      const endTime = Math.min(startTime + zoomSeconds, durationSeconds);
      segs.push({
        startTime,
        widthPx: (endTime - startTime) * pixelsPerSecond,
      });
    }
    return segs;
  }, [durationSeconds, zoomSeconds, pixelsPerSecond]);
  const totalWidthPx =
    durationSeconds > 0 ? durationSeconds * pixelsPerSecond : COLUMN_WIDTH_PX;

  const pixelToTime = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || durationSeconds <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const x = clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, rect.width > 0 ? x / rect.width : 0));
      return fraction * durationSeconds;
    },
    [durationSeconds],
  );

  const playheadPx =
    durationSeconds > 0 ? currentTimeSeconds * pixelsPerSecond : 0;

  const wallClockFormatter = useDateFormatter({
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(clientTimeZone ? { timeZone: clientTimeZone } : {}),
  });

  const wallClockAtPlayhead = useMemo(() => {
    if (!clipStartUnixSec || !Number.isFinite(clipStartUnixSec) || clipStartUnixSec <= 0) return "";
    const offset = Math.max(0, Math.min(currentTimeSeconds, durationSeconds));
    const ms = (clipStartUnixSec + offset) * 1000;
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    return wallClockFormatter.format(d);
  }, [
    clipStartUnixSec,
    currentTimeSeconds,
    durationSeconds,
    wallClockFormatter,
  ]);

  useEffect(() => {
    const content = scrollRef.current;
    const rail = railRef.current;
    if (!content || !rail) return;

    let syncing = false;
    const syncRailFromContent = () => {
      if (syncing) return;
      syncing = true;
      rail.scrollLeft = content.scrollLeft;
      queueMicrotask(() => {
        syncing = false;
      });
    };
    const syncContentFromRail = () => {
      if (syncing) return;
      syncing = true;
      content.scrollLeft = rail.scrollLeft;
      queueMicrotask(() => {
        syncing = false;
      });
    };

    content.addEventListener("scroll", syncRailFromContent, { passive: true });
    rail.addEventListener("scroll", syncContentFromRail, { passive: true });
    rail.scrollLeft = content.scrollLeft;

    return () => {
      content.removeEventListener("scroll", syncRailFromContent);
      rail.removeEventListener("scroll", syncContentFromRail);
    };
  }, [totalWidthPx]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 1 : -1;
        const next = Math.max(0, Math.min(ZOOM_LEVELS_MS.length - 1, zoomIndex + delta));
        if (next !== zoomIndex) onZoomIndexChange(next);
      } else {
        el.scrollLeft += e.deltaY * 2;
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoomIndex, onZoomIndexChange]);

  const scrollStep = 400;

  const handleScrollLeft = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: -scrollStep, behavior: "smooth" });
  }, []);

  const handleScrollRight = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: scrollStep, behavior: "smooth" });
  }, []);

  // After zoom change, keep the playhead (seek line) centered in the viewport
  useLayoutEffect(() => {
    const content = scrollRef.current;
    const rail = railRef.current;
    if (!content || durationSeconds <= 0) return;

    const prev = prevZoomIndexRef.current;
    const zoomChanged = prev !== null && prev !== zoomIndex;

    if (zoomChanged) {
      const t = playheadTimeForZoomRef.current;
      const playheadPxNow = t * pixelsPerSecond;
      const target = playheadPxNow - content.clientWidth / 2;
      const maxScroll = Math.max(0, content.scrollWidth - content.clientWidth);
      const next = Math.max(0, Math.min(target, maxScroll));
      content.scrollLeft = next;
      if (rail) rail.scrollLeft = next;
    } else if (rail) {
      rail.scrollLeft = content.scrollLeft;
    }

    prevZoomIndexRef.current = zoomIndex;
  }, [zoomIndex, totalWidthPx, durationSeconds, pixelsPerSecond]);

  useEffect(() => {
    if (!dragging || !onResizeClip) return;
    const minDuration = 1;
    const stickyPx = 10;

    const onMouseMove = (e: MouseEvent) => {
      const inner = innerRef.current;
      const rect = inner?.getBoundingClientRect();
      const mouseX = rect ? e.clientX - rect.left : null;
      const playheadPxLocal =
        durationSeconds > 0 ? currentTimeSeconds * pixelsPerSecond : 0;

      const isNearPlayhead = mouseX !== null && Math.abs(mouseX - playheadPxLocal) <= stickyPx;
      const stickyTime = currentTimeSeconds;

      let t = pixelToTime(e.clientX);
      if (isNearPlayhead) {
        if (
          (dragging.edge === "left" && stickyTime < dragging.endTime - minDuration) ||
          (dragging.edge === "right" && stickyTime > dragging.startTime + minDuration)
        ) {
          t = stickyTime;
        }
      }
      if (dragging.edge === "left") {
        const newStart = Math.max(0, Math.min(t, dragging.endTime - minDuration));
        onResizeClip(dragging.clipId, newStart, undefined);
        onSeek(newStart);
      } else {
        const newEnd = Math.max(dragging.startTime + minDuration, Math.min(durationSeconds, t));
        onResizeClip(dragging.clipId, undefined, newEnd);
        onSeek(newEnd);
      }
    };
    const onMouseUp = () => setDragging(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, durationSeconds, currentTimeSeconds, pixelsPerSecond, onResizeClip, onSeek, pixelToTime]);

  useEffect(() => {
    if (!adDragging || !onResizeAd) return;
    const minDuration = 1;

    const onMouseMove = (e: MouseEvent) => {
      const t = pixelToTime(e.clientX);
      if (adDragging.edge === "left") {
        const newStart = Math.max(0, Math.min(t, adDragging.endTime - minDuration));
        onResizeAd(adDragging.adId, newStart, undefined);
        onSeek(newStart);
      } else {
        const newEnd = Math.max(adDragging.startTime + minDuration, Math.min(durationSeconds, t));
        onResizeAd(adDragging.adId, undefined, newEnd);
        onSeek(newEnd);
      }
    };
    const onMouseUp = () => setAdDragging(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [adDragging, durationSeconds, onResizeAd, onSeek, pixelToTime]);

  useEffect(() => {
    if (!clipBodyDrag || !onResizeClip) return;
    const minDuration = 1;
    clipBodyDragRef.current = clipBodyDrag;

    const onMouseMove = (e: MouseEvent) => {
      const m = clipBodyDragRef.current;
      if (!m) return;
      const dx = e.clientX - m.lastClientX;
      if (!m.activated) {
        if (Math.abs(dx) < CLIP_BODY_DRAG_THRESHOLD_PX) return;
        onSelectClip?.(m.clipId);
        onSelectAd?.(null);
      }
      const dt = dx / pixelsPerSecond;
      const len = m.endTime - m.startTime;
      let newStart = m.startTime + dt;
      let newEnd = m.endTime + dt;
      if (newStart < 0) {
        newStart = 0;
        newEnd = len;
      }
      if (newEnd > durationSeconds) {
        newEnd = durationSeconds;
        newStart = Math.max(0, durationSeconds - len);
      }
      if (newEnd < newStart + minDuration) return;

      onResizeClip(m.clipId, newStart, newEnd);
      onSeek(newStart);
      clipBodyDragMovedRef.current = true;
      clipBodyDragRef.current = {
        clipId: m.clipId,
        startTime: newStart,
        endTime: newEnd,
        lastClientX: e.clientX,
        activated: true,
      };
    };

    const onMouseUp = () => {
      setClipBodyDrag(null);
      clipBodyDragRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    clipBodyDrag,
    durationSeconds,
    pixelsPerSecond,
    onResizeClip,
    onSeek,
    onSelectClip,
    onSelectAd,
  ]);

  useEffect(() => {
    if (!adBodyDrag || !onResizeAd) return;
    const minDuration = 1;
    adBodyDragRef.current = adBodyDrag;

    const onMouseMove = (e: MouseEvent) => {
      const m = adBodyDragRef.current;
      if (!m) return;
      const dx = e.clientX - m.lastClientX;
      if (!m.activated) {
        if (Math.abs(dx) < CLIP_BODY_DRAG_THRESHOLD_PX) return;
        onSelectAd?.(m.adId);
        onSelectClip?.(null);
      }
      const dt = dx / pixelsPerSecond;
      const len = m.endTime - m.startTime;
      let newStart = m.startTime + dt;
      let newEnd = m.endTime + dt;
      if (newStart < 0) {
        newStart = 0;
        newEnd = len;
      }
      if (newEnd > durationSeconds) {
        newEnd = durationSeconds;
        newStart = Math.max(0, durationSeconds - len);
      }
      if (newEnd < newStart + minDuration) return;

      onResizeAd(m.adId, newStart, newEnd);
      onSeek(newStart);
      adBodyDragMovedRef.current = true;
      adBodyDragRef.current = {
        adId: m.adId,
        startTime: newStart,
        endTime: newEnd,
        lastClientX: e.clientX,
        activated: true,
      };
    };

    const onMouseUp = () => {
      setAdBodyDrag(null);
      adBodyDragRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    adBodyDrag,
    durationSeconds,
    pixelsPerSecond,
    onResizeAd,
    onSeek,
    onSelectAd,
    onSelectClip,
  ]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!trackRef.current || durationSeconds <= 0) return;
      const time = pixelToTime(clientX);
      if (onTrackClick) onTrackClick(time);
      else onSeek(time);
    },
    [durationSeconds, onSeek, onTrackClick, pixelToTime],
  );

  const handleTimelineClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-clip-overlay]") || target.closest("[data-resize-handle]")) return;
      seekFromClientX(e.clientX);
    },
    [seekFromClientX],
  );

  const handleScrubStripClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      seekFromClientX(e.clientX);
    },
    [seekFromClientX],
  );

  const handleClipOverlayClick = useCallback(
    (c: EditorSubClip, isSelected: boolean) => {
      if (clipBodyDragMovedRef.current) {
        clipBodyDragMovedRef.current = false;
        return;
      }
      if (!onSelectClip) return;
      if (!isSelected) onSelectAd?.(null);
      onSelectClip(isSelected ? null : c.id);
      if (!isSelected) onSeek(c.startTime);
    },
    [onSelectClip, onSelectAd, onSeek],
  );

  const handleAdOverlayClick = useCallback(
    (ad: EditorAdMarker, isSelected: boolean) => {
      if (adBodyDragMovedRef.current) {
        adBodyDragMovedRef.current = false;
        return;
      }
      if (!onSelectAd) return;
      if (!isSelected) onSelectClip?.(null);
      onSelectAd(isSelected ? null : ad.id);
      if (!isSelected) onSeek(ad.startTime);
    },
    [onSelectAd, onSelectClip, onSeek],
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
        <div className="flex min-w-0 flex-1 items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-secondary tabular-nums">
            {formatTime(currentTimeSeconds)} / {formatTime(durationSeconds)}
          </span>
          {wallClockAtPlayhead ? (
            <span
              className="max-w-full truncate rounded-md border border-secondary bg-secondary_alt px-2 py-0.5 text-[10px] font-medium tabular-nums text-secondary"
              title={`Program time (${clientTimeZone ?? "local"})`}
            >
              {wallClockAtPlayhead}
            </span>
          ) : null}
          {adsLoading && (
            <span className="animate-pulse text-[10px] font-medium text-amber-500">
              Detecting ads…
            </span>
          )}
          {!adsLoading && ads.length > 0 && (
            <span className="text-[10px] font-medium text-rose-700 dark:text-rose-300">
              {ads.length} ad slot{ads.length !== 1 ? "s" : ""}
            </span>
          )}
          {onMarkIn && onMarkOut ? (
            <EditorMarkInOut
              variant="timeline"
              currentTimeSeconds={currentTimeSeconds}
              selectedClip={selectedClipId ? clips.find((c) => c.id === selectedClipId) ?? null : null}
              onMarkIn={onMarkIn}
              onMarkOut={onMarkOut}
              isDisabled={markInOutDisabled}
            />
          ) : null}
        </div>
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
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border border-secondary bg-secondary">
        <div
          ref={scrollRef}
          id="editor-timeline-scroll"
          className="scrollbar-hide relative overflow-x-auto overflow-y-hidden"
          style={{
            height: TIMELINE_SCRUB_HEIGHT_PX + TIMELINE_FILMSTRIP_HEIGHT_PX,
          }}
        >
          <div
            ref={trackRef}
            className="relative flex min-w-full flex-col"
            style={{ width: totalWidthPx, minWidth: "100%" }}
          >
            <div
              className="relative z-[15] shrink-0 cursor-crosshair border-b border-secondary bg-secondary_alt/90"
              style={{ height: TIMELINE_SCRUB_HEIGHT_PX }}
              onMouseMove={(e) => {
                const el = e.currentTarget;
                const r = el.getBoundingClientRect();
                setScrubHoverX(Math.max(0, Math.min(r.width, e.clientX - r.left)));
              }}
              onMouseLeave={() => setScrubHoverX(null)}
              onClick={handleScrubStripClick}
              aria-label="Seek — click to jump playhead; hover shows preview line"
            >
              {scrubHoverX !== null && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-brand-secondary"
                  style={{ left: scrubHoverX, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.15)" }}
                  aria-hidden
                />
              )}
            </div>
            <div
              ref={innerRef}
              className="relative flex shrink-0 cursor-pointer flex-row overflow-visible"
              style={{
                width: totalWidthPx,
                height: TIMELINE_FILMSTRIP_HEIGHT_PX,
              }}
              onClick={handleTimelineClick}
            >
            {timelineSegments.map((seg, i) => {
              const thumbUrl = buildThumbnailUrl(clipUrl, seg.startTime, channelId);
              return (
                <div
                  key={`${seg.startTime}-${i}`}
                  className="flex shrink-0 flex-col"
                  style={{ width: seg.widthPx }}
                >
                  <div
                    className="min-h-0 flex-1 w-full bg-quaternary"
                    style={{ width: seg.widthPx }}
                  >
                    <img
                      src={thumbUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex h-6 shrink-0 items-center justify-center text-[10px] text-tertiary">
                    {formatTime(seg.startTime)}
                  </div>
                </div>
              );
            })}
          {/* Ad slots (subtle rose/red, same trim handles as clips) */}
          {ads.map((ad) => {
            const adLeft = ad.startTime * pixelsPerSecond;
            const adWidth = (ad.endTime - ad.startTime) * pixelsPerSecond;
            const isAdHover = hoverAdId === ad.id;
            const isAdSelected = selectedAdId === ad.id;
            const canResizeAd = onResizeAd && adWidth > 8;

            return (
              <div
                key={ad.id}
                data-clip-overlay
                role={onSelectAd ? "button" : undefined}
                tabIndex={onSelectAd ? 0 : undefined}
                onClick={onSelectAd ? () => handleAdOverlayClick(ad, isAdSelected) : undefined}
                onKeyDown={
                  onSelectAd
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleAdOverlayClick(ad, isAdSelected);
                        }
                      }
                    : undefined
                }
                onMouseDown={(e) => {
                  if (!onResizeAd) return;
                  const el = e.target as HTMLElement;
                  if (el.closest("[data-resize-handle]") || el.closest("button")) return;
                  e.preventDefault();
                  e.stopPropagation();
                  adBodyDragMovedRef.current = false;
                  setAdBodyDrag({
                    adId: ad.id,
                    startTime: ad.startTime,
                    endTime: ad.endTime,
                    lastClientX: e.clientX,
                    activated: false,
                  });
                }}
                className={cx(
                  "absolute top-0 bottom-0 z-[9] select-none touch-none transition-colors",
                  onResizeAd && "cursor-move",
                  isAdSelected
                    ? "bg-rose-500/32 ring-2 ring-rose-400/55 dark:bg-rose-500/28 dark:ring-rose-400/45"
                    : "bg-rose-500/18 hover:bg-rose-500/28 dark:bg-rose-500/15 dark:hover:bg-rose-500/26",
                )}
                style={{
                  left: adLeft,
                  width: Math.max(adWidth, 4),
                  minWidth: 4,
                }}
                onMouseEnter={() => setHoverAdId(ad.id)}
                onMouseLeave={() => setHoverAdId(null)}
              >
                <div className="absolute top-1 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-rose-200/90 bg-rose-50/95 px-1.5 py-0.5 text-[9px] font-semibold text-rose-900 shadow-sm dark:border-rose-800/80 dark:bg-rose-950/92 dark:text-rose-100">
                  AD #{ad.index}
                </div>

                {canResizeAd && (
                  <>
                    <ClipFilmstripTrimHandle
                      variant="ad"
                      edge="left"
                      ariaLabel="Resize ad slot start"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectAd?.(ad.id);
                        setAdDragging({ adId: ad.id, edge: "left", startTime: ad.startTime, endTime: ad.endTime });
                      }}
                    />
                    <ClipFilmstripTrimHandle
                      variant="ad"
                      edge="right"
                      ariaLabel="Resize ad slot end"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectAd?.(ad.id);
                        setAdDragging({ adId: ad.id, edge: "right", startTime: ad.startTime, endTime: ad.endTime });
                      }}
                    />
                  </>
                )}

                {onRemoveAd && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveAd(ad.id);
                    }}
                    className={`absolute bottom-1 left-1/2 z-20 flex size-5 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full bg-primary text-fg-secondary shadow transition-opacity ${
                      isAdHover ? "opacity-100" : "opacity-0"
                    }`}
                    aria-label="Remove ad slot"
                  >
                    <Trash01 className="size-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Clip overlays (blue) */}
          {clips.map((c) => {
            const left = c.startTime * pixelsPerSecond;
            const width = (c.endTime - c.startTime) * pixelsPerSecond;
            const isHover = hoverClipId === c.id;
            const isSelected = selectedClipId === c.id;
            const canResize = onResizeClip && width > 8;
            return (
              <div
                key={c.id}
                data-clip-overlay
                data-editor-subclip-focus
                role={onSelectClip ? "button" : undefined}
                tabIndex={onSelectClip ? 0 : undefined}
                onClick={onSelectClip ? () => handleClipOverlayClick(c, isSelected) : undefined}
                onKeyDown={
                  onSelectClip
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleClipOverlayClick(c, isSelected);
                        }
                      }
                    : undefined
                }
                onMouseDown={(e) => {
                  if (!onResizeClip) return;
                  const el = e.target as HTMLElement;
                  if (el.closest("[data-resize-handle]") || el.closest("button")) return;
                  e.preventDefault();
                  e.stopPropagation();
                  clipBodyDragMovedRef.current = false;
                  setClipBodyDrag({
                    clipId: c.id,
                    startTime: c.startTime,
                    endTime: c.endTime,
                    lastClientX: e.clientX,
                    activated: false,
                  });
                }}
                className={cx(
                  "absolute top-0 bottom-0 z-10 flex select-none touch-none items-start justify-center transition-colors",
                  onResizeClip && "cursor-move",
                  isSelected
                    ? "ring-2 ring-brand-solid bg-blue-500/50"
                    : "bg-blue-500/30 hover:bg-blue-500/50",
                )}
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
                    <ClipFilmstripTrimHandle
                      edge="left"
                      ariaLabel="Resize sub-clip start"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectAd?.(null);
                        onSelectClip?.(c.id);
                        setDragging({ clipId: c.id, edge: "left", startTime: c.startTime, endTime: c.endTime });
                      }}
                    />
                    <ClipFilmstripTrimHandle
                      edge="right"
                      ariaLabel="Resize sub-clip end"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectAd?.(null);
                        onSelectClip?.(c.id);
                        setDragging({ clipId: c.id, edge: "right", startTime: c.startTime, endTime: c.endTime });
                      }}
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
                    className={`mt-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-primary text-fg-secondary shadow ${
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
            </div>
            <div
              className="pointer-events-none absolute top-0 z-[22] flex flex-col items-center"
              style={{
                left: playheadPx,
                height: TIMELINE_SCRUB_HEIGHT_PX + TIMELINE_FILMSTRIP_HEIGHT_PX,
                transform: "translateX(-50%)",
              }}
            >
              <div
                className="border-x-[5px] border-t-[6px] border-x-transparent border-t-red-500"
                style={{ width: 0, height: 0 }}
                aria-hidden
              />
              <div className="w-0.5 flex-1 min-h-0 shrink bg-red-500" />
              <div
                className="border-x-[5px] border-b-[6px] border-x-transparent border-b-red-500"
                style={{ width: 0, height: 0 }}
                aria-hidden
              />
            </div>
          </div>
        </div>
        <div
          ref={railRef}
          className="scrollbar-thin shrink-0 overflow-x-auto overflow-y-hidden border-t border-secondary bg-secondary"
          style={{ height: TIMELINE_RAIL_HEIGHT_PX }}
          aria-label="Timeline horizontal scroll"
          aria-controls="editor-timeline-scroll"
        >
          <div style={{ width: totalWidthPx, height: 1 }} aria-hidden />
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
