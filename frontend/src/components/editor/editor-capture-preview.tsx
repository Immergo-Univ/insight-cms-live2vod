import { useCallback, useRef } from "react";
import { Camera01, Image01 } from "@untitledui/icons";
import type { EditorPosterEntry } from "@/types/editor";
import { formatTime } from "./editor-timeline";

/** Canvas resolution for a sharp preview (16:9). */
const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ?? false;
}

function drawVideoFrameToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  delayMs: number = 0
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const draw = () => {
    ctx.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  };
  if (delayMs > 0) {
    setTimeout(draw, delayMs);
  } else {
    draw();
  }
}

interface EditorCapturePreviewProps {
  posters: EditorPosterEntry[];
  currentTimeSeconds: number;
  onCapture: () => void;
  onRemovePoster: (id: string) => void;
  onSeek?: (timeSeconds: number) => void;
  getVideoElement: () => HTMLVideoElement | null;
  isDisabled?: boolean;
}

export function EditorCapturePreview({
  posters,
  currentTimeSeconds,
  onCapture,
  onRemovePoster,
  onSeek,
  getVideoElement,
  isDisabled,
}: EditorCapturePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleCapture = useCallback(() => {
    const video = getVideoElement();
    const canvas = canvasRef.current;
    if (video && canvas) {
      drawVideoFrameToCanvas(video, canvas, isSafari() ? 500 : 0);
    }
    onCapture();
  }, [getVideoElement, onCapture]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-secondary bg-secondary p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary">
        Preview
      </h3>
      <div className="flex w-full flex-col gap-0.5">
        <div className="w-full overflow-hidden rounded border border-secondary bg-quaternary" style={{ aspectRatio: `${PREVIEW_WIDTH}/${PREVIEW_HEIGHT}` }}>
          <canvas
            ref={canvasRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            className="block size-full rounded object-cover"
          />
        </div>
        <span className="text-[10px] text-tertiary">
          {posters.length > 0 ? `Last: ${formatTime(posters[posters.length - 1].timeSeconds)}` : `Current: ${formatTime(currentTimeSeconds)}`}
        </span>
      </div>
      <button
        type="button"
        onClick={handleCapture}
        disabled={isDisabled}
        className="w-full flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover disabled:opacity-50"
      >
        <Camera01 className="size-4" />
        Capture
      </button>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary">
        Captured
      </h3>
      <div className="min-h-[60px] w-full rounded border border-secondary bg-primary">
        {posters.length === 0 ? (
          <div className="flex h-[60px] flex-col items-center justify-center gap-0.5 p-2 text-center text-tertiary">
            <Image01 className="size-5 text-fg-quaternary" />
            <span className="text-[10px]">Captured frames list</span>
          </div>
        ) : (
          <ul className="flex max-h-[120px] flex-col gap-1 overflow-y-auto p-2">
            {posters.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded border border-secondary bg-secondary px-2 py-1 text-xs"
              >
                <button
                  type="button"
                  onClick={() => onSeek?.(p.timeSeconds)}
                  className="font-medium text-brand-secondary hover:underline"
                >
                  {formatTime(p.timeSeconds)}
                </button>
                <button
                  type="button"
                  onClick={() => onRemovePoster(p.id)}
                  className="rounded p-0.5 text-fg-quaternary hover:bg-tertiary hover:text-fg-secondary"
                  aria-label="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
