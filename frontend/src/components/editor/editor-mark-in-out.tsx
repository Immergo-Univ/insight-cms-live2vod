import { useCallback, useRef } from "react";
import { formatTime } from "./editor-timeline";

const PREVIEW_WIDTH = 160;
const PREVIEW_HEIGHT = 96;

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

interface EditorMarkInOutProps {
  currentTimeSeconds: number;
  markInTime: number | null;
  onMarkIn: (timeSeconds: number) => void;
  onMarkOut: (timeSeconds: number) => void;
  getVideoElement: () => HTMLVideoElement | null;
  isDisabled?: boolean;
}

export function EditorMarkInOut({
  currentTimeSeconds,
  markInTime,
  onMarkIn,
  onMarkOut,
  getVideoElement,
  isDisabled,
}: EditorMarkInOutProps) {
  const canvasInRef = useRef<HTMLCanvasElement>(null);
  const canvasOutRef = useRef<HTMLCanvasElement>(null);

  const handleMarkIn = useCallback(() => {
    const video = getVideoElement();
    const canvas = canvasInRef.current;
    if (video && canvas) {
      drawVideoFrameToCanvas(
        video,
        canvas,
        isSafari() ? 500 : 0
      );
    }
    onMarkIn(currentTimeSeconds);
  }, [currentTimeSeconds, getVideoElement, onMarkIn]);

  const handleMarkOut = useCallback(() => {
    const video = getVideoElement();
    const canvas = canvasOutRef.current;
    if (video && canvas) {
      drawVideoFrameToCanvas(
        video,
        canvas,
        isSafari() ? 500 : 0
      );
    }
    onMarkOut(currentTimeSeconds);
  }, [currentTimeSeconds, getVideoElement, onMarkOut]);

  const canMarkOut = markInTime !== null && currentTimeSeconds > markInTime;

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col items-center gap-1">
        <div className="rounded border border-secondary bg-quaternary" style={{ width: 80, height: 48 }}>
          <canvas
            ref={canvasInRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            className="size-full rounded object-cover"
            style={{ width: 80, height: 48 }}
          />
        </div>
        <span className="text-[10px] text-tertiary">
          {markInTime !== null ? formatTime(markInTime) : "In"}
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="rounded border border-secondary bg-quaternary" style={{ width: 80, height: 48 }}>
          <canvas
            ref={canvasOutRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            className="size-full rounded object-cover"
            style={{ width: 80, height: 48 }}
          />
        </div>
        <span className="text-[10px] text-tertiary">
          {formatTime(currentTimeSeconds)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleMarkIn}
          disabled={isDisabled}
          className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover disabled:opacity-50"
        >
          Mark In
        </button>
        <button
          type="button"
          onClick={handleMarkOut}
          disabled={isDisabled || !canMarkOut}
          className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover disabled:opacity-50"
        >
          Mark Out
        </button>
      </div>
    </div>
  );
}
