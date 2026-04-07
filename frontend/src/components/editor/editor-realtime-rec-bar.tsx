import { useMemo } from "react";
import type { EditorSubClip } from "@/types/editor";

interface EditorRealtimeRecBarProps {
  clips: EditorSubClip[];
  markInTime: number | null;
  onRecPress: () => void;
  /** IANA zone from ?tz= (via useTimezone); drives wall-clock label. */
  timeZone: string;
  /** Bumps every second while realtime mode is active so the clock refreshes. */
  clockTick: number;
  isDisabled?: boolean;
}

export function EditorRealtimeRecBar({
  clips,
  markInTime,
  onRecPress,
  timeZone,
  clockTick,
  isDisabled,
}: EditorRealtimeRecBarProps) {
  const awaitingOut = markInTime !== null;
  const liveNowLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone,
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date()),
    [timeZone, clockTick],
  );

  return (
    <div className="rounded-lg border border-secondary bg-secondary px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-secondary tabular-nums">
            Live — {liveNowLabel}
          </span>
          {awaitingOut ? (
            <span className="text-[11px] font-medium text-amber-600">
              Press REC again for Mark Out
            </span>
          ) : (
            <span className="text-[11px] text-tertiary">
              Press REC for Mark In, then again for Mark Out. Clips: {clips.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRecPress}
          disabled={isDisabled}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-2 border-red-600 bg-red-600/15 px-4 py-2.5 text-sm font-bold tracking-wide text-red-700 transition-colors hover:bg-red-600/25 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
          aria-pressed={awaitingOut}
          aria-label={awaitingOut ? "Mark out" : "Mark in"}
        >
          <span
            className={`size-2.5 rounded-full bg-red-600 ${awaitingOut ? "animate-pulse" : ""}`}
            aria-hidden
          />
          REC
        </button>
      </div>
    </div>
  );
}
