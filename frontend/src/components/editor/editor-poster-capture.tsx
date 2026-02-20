import { useCallback } from "react";
import { Camera01, Trash01 } from "@untitledui/icons";
import type { EditorPosterEntry } from "@/types/editor";
import { formatTime } from "./editor-timeline";

interface EditorPosterCaptureProps {
  posters: EditorPosterEntry[];
  onCapture: () => void;
  onRemove: (id: string) => void;
  onSeek?: (timeSeconds: number) => void;
  currentTimeSeconds: number;
  isDisabled?: boolean;
}

export function EditorPosterCapture({
  posters,
  onCapture,
  onRemove,
  onSeek,
  currentTimeSeconds,
  isDisabled,
}: EditorPosterCaptureProps) {
  const handleCapture = useCallback(() => {
    if (!isDisabled) onCapture();
  }, [onCapture, isDisabled]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleCapture}
          disabled={isDisabled}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          title="Capture poster at current time"
        >
          <Camera01 className="size-4 text-fg-secondary" />
          Capture
        </button>
        <span className="text-xs text-tertiary">
          Poster at {formatTime(currentTimeSeconds)}
        </span>
      </div>
      {posters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {posters.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-lg border border-secondary bg-secondary px-2 py-1.5 text-xs"
            >
              <button
                type="button"
                onClick={() => onSeek?.(p.timeSeconds)}
                className="font-medium text-brand-secondary hover:underline"
              >
                {formatTime(p.timeSeconds)}
              </button>
              <span className="text-tertiary">· {p.orientation}</span>
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                className="ml-1 rounded p-0.5 text-fg-quaternary hover:bg-tertiary hover:text-fg-secondary"
                aria-label="Remove poster"
              >
                <Trash01 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
