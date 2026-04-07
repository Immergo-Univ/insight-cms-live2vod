import { useDateFormatter } from "react-aria";
import type { EditorSubClip } from "@/types/editor";
import { formatTime } from "./editor-timeline";

interface EditorRealtimeRecBarProps {
  clips: EditorSubClip[];
  markInTime: number | null;
  onRecPress: () => void;
  /** Live buffer position (seconds) for display only. */
  currentTimeSeconds: number;
  /** Unix seconds when the realtime session started (t0 for wall-clock math). */
  sessionStartUnixSec: number;
  /** IANA zone from ?tz= (or browser); used to label wall-clock instants. */
  clientTimeZone: string;
  isDisabled?: boolean;
}

export function EditorRealtimeRecBar({
  clips,
  markInTime,
  onRecPress,
  currentTimeSeconds,
  sessionStartUnixSec,
  clientTimeZone,
  isDisabled,
}: EditorRealtimeRecBarProps) {
  const awaitingOut = markInTime !== null;

  const wallFormatter = useDateFormatter({
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: clientTimeZone,
  });

  const formatWall = (unixSec: number) => wallFormatter.format(new Date(unixSec * 1000));

  const sessionWallLabel = formatWall(sessionStartUnixSec);
  const markInWallUnix =
    awaitingOut && markInTime !== null ? sessionStartUnixSec + markInTime : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-secondary bg-secondary px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="rounded-md border border-secondary bg-primary px-2 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
              Clip timing (wall clock)
            </p>
            <p className="mt-0.5 text-[11px] text-tertiary">
              Timezone <span className="font-mono text-secondary">{clientTimeZone}</span>. Sub-clips are seconds{" "}
              <em>after</em> session start t0 (below). Absolute in/out = t0 + offset.
            </p>
            <p className="mt-1 text-xs font-medium tabular-nums text-primary" title={`t0 = Unix ${sessionStartUnixSec}`}>
              t0 session start: {sessionWallLabel}
            </p>
          </div>
          <span className="text-xs font-medium text-secondary tabular-nums">
            Player buffer position — {formatTime(currentTimeSeconds)} (not the same as wall-clock marks)
          </span>
          {awaitingOut && markInWallUnix !== null ? (
            <span className="text-[11px] font-medium text-amber-600">
              Mark In wall time — {formatWall(markInWallUnix)} · press REC again for Mark Out
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
      <div className="flex h-[120px] items-center justify-center rounded-md border border-dashed border-secondary bg-primary px-2">
        <p className="max-w-md text-center text-xs text-tertiary">
          No archive thumbnails. REC boundaries are wall-clock instants in {clientTimeZone}, computed as t0 (
          {sessionWallLabel}) plus each stored offset.
        </p>
      </div>
    </div>
  );
}
