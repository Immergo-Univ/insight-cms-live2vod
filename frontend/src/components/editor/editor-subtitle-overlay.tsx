import type { EditorSubtitleSettings, EditorSubtitleStyle } from "@/types/editor";
import type { VideoContentRect } from "./editor-vertical-crop-overlay";

/** Scale preview font to the visible video area (reference: 720p height). */
function previewFontSizePx(style: EditorSubtitleStyle, contentH: number) {
  if (contentH <= 0) return Math.max(10, style.fontSizePx * 0.35);
  const scaled = (style.fontSizePx * contentH) / 720;
  return Math.max(10, Math.min(96, scaled));
}

function outlineTextShadow(widthPx: number, color: string): string {
  if (widthPx <= 0) return "none";
  const w = Math.min(6, widthPx);
  const steps: string[] = [];
  for (let dx = -w; dx <= w; dx++) {
    for (let dy = -w; dy <= w; dy++) {
      if (dx === 0 && dy === 0) continue;
      steps.push(`${dx}px ${dy}px 0 ${color}`);
    }
  }
  return steps.length ? steps.join(", ") : "none";
}

interface EditorSubtitleOverlayProps {
  contentRect: VideoContentRect;
  settings: EditorSubtitleSettings;
}

/** Read-only burn-in preview; configure via the clip row burn-in control. */
export function EditorSubtitleOverlay({ contentRect, settings }: EditorSubtitleOverlayProps) {
  const { style } = settings;

  if (contentRect.w <= 0 || contentRect.h <= 0) return null;

  const fs = previewFontSizePx(style, contentRect.h);
  const shadow = outlineTextShadow(style.outlineWidthPx, style.outlineColor);

  return (
    <div
      className="pointer-events-none absolute z-[6]"
      style={{
        left: contentRect.x,
        top: contentRect.y,
        width: contentRect.w,
        height: contentRect.h,
      }}
    >
      <div className="pointer-events-none absolute right-3 bottom-4 left-3 flex items-end justify-center">
        <div className="flex max-w-full items-center rounded-md bg-black/35 px-3 py-1.5">
          <span
            className="max-w-[min(100%,28rem)] break-words text-center font-semibold"
            style={{
              fontSize: fs,
              color: style.textColor,
              textShadow: shadow,
              lineHeight: 1.2,
            }}
          >
            Example text
          </span>
        </div>
      </div>
    </div>
  );
}
