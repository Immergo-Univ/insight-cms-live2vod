import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

export interface VideoContentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EditorVerticalCropOverlayProps {
  contentRect: VideoContentRect;
  /** Horizontal center of the strip along the visible picture (0–1). */
  centerX: number;
  onCenterXChange: (centerX: number) => void;
}

const ASPECT = 9 / 16;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function EditorVerticalCropOverlay({
  contentRect,
  centerX,
  onCenterXChange,
}: EditorVerticalCropOverlayProps) {
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startCenterX: number;
  } | null>(null);

  const stripW = contentRect.h * ASPECT;
  const minCenter =
    contentRect.w > 0 ? (stripW / 2) / contentRect.w : 0.5;
  const maxCenter = contentRect.w > 0 ? 1 - minCenter : 0.5;

  const handlePointerDownStrip = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startCenterX: centerX,
      };
    },
    [centerX],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId || contentRect.w <= 0) return;
      const deltaPx = e.clientX - d.startClientX;
      const deltaNorm = deltaPx / contentRect.w;
      const next = clamp(d.startCenterX + deltaNorm, minCenter, maxCenter);
      onCenterXChange(next);
    },
    [contentRect.w, minCenter, maxCenter, onCenterXChange],
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
  }, []);

  if (contentRect.w <= 0 || contentRect.h <= 0 || stripW <= 0) return null;

  const centerPx = contentRect.x + centerX * contentRect.w;
  const stripLeft = centerPx - stripW / 2;
  const stripTop = contentRect.y;
  const stripHeight = contentRect.h;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden rounded-lg">
      <div
        className="absolute top-0 right-0 left-0 bg-black/55"
        style={{ height: stripTop }}
        aria-hidden
      />
      <div
        className="absolute right-0 bottom-0 left-0 bg-black/55"
        style={{ top: stripTop + stripHeight }}
        aria-hidden
      />
      <div
        className="absolute bg-black/55"
        style={{
          top: stripTop,
          left: 0,
          width: stripLeft,
          height: stripHeight,
        }}
        aria-hidden
      />
      <div
        className="absolute bg-black/55"
        style={{
          top: stripTop,
          left: stripLeft + stripW,
          right: 0,
          height: stripHeight,
        }}
        aria-hidden
      />
      <div
        role="slider"
        aria-label="Vertical crop position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(centerX * 100)}
        tabIndex={0}
        className="pointer-events-auto absolute cursor-grab border-2 border-white/90 shadow-lg active:cursor-grabbing"
        style={{
          left: stripLeft,
          top: stripTop,
          width: stripW,
          height: stripHeight,
          touchAction: "none",
        }}
        onPointerDown={handlePointerDownStrip}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}

export function computeVideoContentRect(
  outer: HTMLElement,
  video: HTMLVideoElement | null,
): VideoContentRect {
  if (!video) return { x: 0, y: 0, w: 0, h: 0 };
  const cw = outer.clientWidth;
  const ch = outer.clientHeight;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !cw || !ch) return { x: 0, y: 0, w: 0, h: 0 };
  const ar = vw / vh;
  const car = cw / ch;
  let w: number;
  let h: number;
  let x: number;
  let y: number;
  if (car > ar) {
    h = ch;
    w = h * ar;
    x = (cw - w) / 2;
    y = 0;
  } else {
    w = cw;
    h = w / ar;
    x = 0;
    y = (ch - h) / 2;
  }
  return { x, y, w, h };
}
