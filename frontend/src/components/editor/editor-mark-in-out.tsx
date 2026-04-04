import type { EditorSubClip } from "@/types/editor";

interface EditorMarkInOutProps {
  currentTimeSeconds: number;
  markInTime: number | null;
  /** When set, Mark In/Out edit this subclip's start/end. */
  selectedClip?: EditorSubClip | null;
  onMarkIn: (timeSeconds: number) => void;
  onMarkOut: (timeSeconds: number) => void;
  isDisabled?: boolean;
  /** Inline row under the player (timeline toolbar) vs prominent toolbar buttons. */
  variant?: "toolbar" | "timeline";
}

export function EditorMarkInOut({
  currentTimeSeconds,
  markInTime,
  selectedClip = null,
  onMarkIn,
  onMarkOut,
  isDisabled,
  variant = "toolbar",
}: EditorMarkInOutProps) {
  const canMarkIn = selectedClip
    ? currentTimeSeconds < selectedClip.endTime
    : true;
  const canMarkOut = selectedClip
    ? currentTimeSeconds > selectedClip.startTime
    : markInTime !== null && currentTimeSeconds > markInTime;
  const isMarkInRangeSelectionActive = !selectedClip && markInTime !== null;

  if (variant === "timeline") {
    const baseBtn =
      "rounded-md border px-2 py-1 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-secondary/30 disabled:cursor-not-allowed disabled:opacity-50";
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onMarkIn(currentTimeSeconds)}
          disabled={isDisabled || !canMarkIn}
          className={`${baseBtn} border-secondary bg-primary text-primary hover:bg-secondary ${
            isMarkInRangeSelectionActive ? "border-blue-500 ring-2 ring-blue-500/35" : ""
          }`}
          title="Mark In"
        >
          Mark In
        </button>
        <button
          type="button"
          onClick={() => onMarkOut(currentTimeSeconds)}
          disabled={isDisabled || !canMarkOut}
          className={`${baseBtn} border-secondary bg-primary text-primary hover:bg-secondary`}
          title="Mark Out"
        >
          Mark Out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onMarkIn(currentTimeSeconds)}
        disabled={isDisabled || !canMarkIn}
        className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover disabled:opacity-50"
      >
        Mark In
      </button>
      <button
        type="button"
        onClick={() => onMarkOut(currentTimeSeconds)}
        disabled={isDisabled || !canMarkOut}
        className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover disabled:opacity-50"
      >
        Mark Out
      </button>
    </div>
  );
}
