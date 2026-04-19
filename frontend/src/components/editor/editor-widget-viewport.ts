import type { VideoContentRect } from "./editor-vertical-crop-overlay";

const STRIP_ASPECT = 9 / 16;

/** Pixel rect in the same space as `VideoContentRect` (relative to the aspect-video player box). */
export type EditorWidgetViewportPx = { x: number; y: number; w: number; h: number };

/**
 * Layout area for clip widgets: full visible video when vertical crop is off;
 * otherwise the 9:16 strip (same geometry as the vertical crop preview strip).
 */
export function computeWidgetViewportRect(
  contentRect: VideoContentRect,
  verticalCropActive: boolean,
  centerX: number,
): EditorWidgetViewportPx {
  if (!verticalCropActive || contentRect.w <= 0 || contentRect.h <= 0) {
    return { x: contentRect.x, y: contentRect.y, w: contentRect.w, h: contentRect.h };
  }
  const stripW = contentRect.h * STRIP_ASPECT;
  const centerPx = contentRect.x + centerX * contentRect.w;
  const stripLeft = centerPx - stripW / 2;
  return {
    x: stripLeft,
    y: contentRect.y,
    w: stripW,
    h: contentRect.h,
  };
}
