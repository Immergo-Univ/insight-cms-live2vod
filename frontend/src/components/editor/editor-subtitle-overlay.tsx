import { useCallback, useState } from "react";
import { Edit03 } from "@untitledui/icons";
import type { EditorSubtitleStyle } from "@/types/editor";
import type { VideoContentRect } from "./editor-vertical-crop-overlay";
import { EditorSubtitleStyleModal } from "./editor-subtitle-style-modal";

const overlayButtonClass =
  "flex size-9 cursor-pointer items-center justify-center rounded-md bg-black/60 text-white transition-colors hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/50";

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
  style: EditorSubtitleStyle;
  onStyleChange: (next: EditorSubtitleStyle) => void;
}

export function EditorSubtitleOverlay({ contentRect, style, onStyleChange }: EditorSubtitleOverlayProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const openModal = useCallback(() => setModalOpen(true), []);

  if (contentRect.w <= 0 || contentRect.h <= 0) return null;

  const fs = previewFontSizePx(style, contentRect.h);
  const shadow = outlineTextShadow(style.outlineWidthPx, style.outlineColor);

  return (
    <>
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
          <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-md bg-black/35 px-2 py-1.5">
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
            <button
              type="button"
              onClick={openModal}
              className={overlayButtonClass}
              title="Edit subtitle style"
              aria-label="Edit subtitle style"
            >
              <Edit03 className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <EditorSubtitleStyleModal
        isOpen={modalOpen}
        onOpenChange={setModalOpen}
        style={style}
        onSave={onStyleChange}
      />
    </>
  );
}
