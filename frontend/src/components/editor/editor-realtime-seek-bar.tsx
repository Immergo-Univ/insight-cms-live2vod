import { useMemo } from "react";

interface EditorRealtimeSeekBarProps {
  /** Live edge (Unix seconds). Slider maximum. */
  liveEpoch: number;
  /** Oldest scrubbable instant (Unix seconds): liveEpoch - seek-back buffer. Slider minimum. */
  minEpoch: number;
  /** Absolute Unix epoch under the playhead (drives thumb position + labels). */
  playheadEpoch: number;
  /** Playback mode: at the live edge or in a fixed past window. */
  mode: "live" | "window";
  /** Called with the target Unix epoch when the user scrubs. */
  onScrub: (targetEpoch: number) => void;
  /** Jump back to the live edge. */
  onGoLive: () => void;
  /** IANA zone from ?tz= (via useTimezone); drives the wall-clock label. */
  timeZone: string;
  isDisabled?: boolean;
}

/** Human-readable "behind live" delta, e.g. "LIVE", "-12:34" or "-1:02:03". */
function formatBehind(secondsBehind: number): string {
  const s = Math.max(0, Math.floor(secondsBehind));
  if (s <= 1) return "LIVE";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `-${h}:${mm}:${ss}` : `-${m}:${ss}`;
}

export function EditorRealtimeSeekBar({
  liveEpoch,
  minEpoch,
  playheadEpoch,
  mode,
  onScrub,
  onGoLive,
  timeZone,
  isDisabled,
}: EditorRealtimeSeekBarProps) {
  const value = Math.min(Math.max(playheadEpoch, minEpoch), liveEpoch);
  const isLive = mode === "live";

  const playheadLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(value * 1000)),
    [timeZone, value],
  );

  const behindLabel = isLive ? "LIVE" : formatBehind(liveEpoch - playheadEpoch);

  return (
    <div className="rounded-lg border border-secondary bg-secondary px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[11px] font-medium text-tertiary tabular-nums">-1h</span>
        <input
          type="range"
          min={minEpoch}
          max={liveEpoch}
          step={1}
          value={value}
          disabled={isDisabled}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Seek within the last hour"
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-tertiary accent-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="shrink-0 text-[11px] font-medium text-tertiary tabular-nums">LIVE</span>
        <div className="flex shrink-0 items-center gap-2 pl-1">
          <span className="min-w-[64px] text-right text-xs font-medium text-secondary tabular-nums">
            {playheadLabel}
          </span>
          <span
            className={`min-w-[52px] text-right text-[11px] font-semibold tabular-nums ${
              isLive ? "text-red-600 dark:text-red-400" : "text-amber-600"
            }`}
          >
            {behindLabel}
          </span>
          <button
            type="button"
            onClick={onGoLive}
            disabled={isDisabled || isLive}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-red-600 px-2.5 py-1 text-[11px] font-bold tracking-wide text-red-700 transition-colors hover:bg-red-600/15 disabled:cursor-default disabled:opacity-40 dark:text-red-400"
            aria-label="Go to live edge"
            title="Go to live edge"
          >
            <span
              className={`size-2 rounded-full bg-red-600 ${isLive ? "animate-pulse" : ""}`}
              aria-hidden
            />
            LIVE
          </button>
        </div>
      </div>
    </div>
  );
}
