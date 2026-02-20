import type { EditorSubClip } from "@/types/editor";

interface EditorMarkInOutProps {
  currentTimeSeconds: number;
  markInTime: number | null;
  /** When set, Mark In/Out edit this subclip's start/end. */
  selectedClip?: EditorSubClip | null;
  onMarkIn: (timeSeconds: number) => void;
  onMarkOut: (timeSeconds: number) => void;
  isDisabled?: boolean;
}

export function EditorMarkInOut({
  currentTimeSeconds,
  markInTime,
  selectedClip = null,
  onMarkIn,
  onMarkOut,
  isDisabled,
}: EditorMarkInOutProps) {
  const canMarkIn = selectedClip
    ? currentTimeSeconds < selectedClip.endTime
    : true;
  const canMarkOut = selectedClip
    ? currentTimeSeconds > selectedClip.startTime
    : markInTime !== null && currentTimeSeconds > markInTime;

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
