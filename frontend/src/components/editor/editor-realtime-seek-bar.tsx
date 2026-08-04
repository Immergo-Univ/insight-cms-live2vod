import { useEffect, useMemo, useState } from "react";

/** Seconds of tolerance to consider the real playhead as having caught up to a committed scrub. */
const CATCH_UP_TOLERANCE_SEC = 2;

interface EditorRealtimeSeekBarProps {
  /** Live edge (Unix seconds). Slider maximum. */
  liveEpoch: number;
  /** Oldest scrubbable instant (Unix seconds): liveEpoch - seek-back buffer. Slider minimum. */
  minEpoch: number;
  /** Absolute Unix epoch under the playhead (drives thumb position + labels). */
  playheadEpoch: number;
  /** Playback mode: at the live edge or in a fixed past window. */
  mode: "live" | "window";
  /** Called with the target Unix epoch when the user commits a scrub (on release). */
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
  // While dragging we track the value locally and only commit onScrub on release, so the
  // player source is not swapped mid-drag (non-blocking scrub).
  const [dragValue, setDragValue] = useState<number | null>(null);
  // After releasing, the thumb stays pinned at the dropped position until the real playhead
  // catches up (the new archive window may still be loading), so it never snaps back.
  const [heldValue, setHeldValue] = useState<number | null>(null);

  const clamp = (v: number) => Math.min(Math.max(v, minEpoch), liveEpoch);
  const displayValue = clamp(dragValue ?? heldValue ?? playheadEpoch);
  const span = Math.max(1, liveEpoch - minEpoch);
  const pct = Math.min(100, Math.max(0, ((displayValue - minEpoch) / span) * 100));

  const isLive = mode === "live" && dragValue === null && heldValue === null;

  // Release the pinned value once the real playhead reaches the committed position.
  useEffect(() => {
    if (heldValue === null) return;
    if (Math.abs(playheadEpoch - heldValue) <= CATCH_UP_TOLERANCE_SEC) {
      setHeldValue(null);
    }
  }, [playheadEpoch, heldValue]);

  const playheadLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(displayValue * 1000)),
    [timeZone, displayValue],
  );

  const behindLabel = isLive ? "LIVE" : formatBehind(liveEpoch - displayValue);

  const commit = () => {
    if (dragValue === null) return;
    const target = clamp(dragValue);
    setDragValue(null);
    setHeldValue(target);
    onScrub(target);
  };

  // Commit on pointer release and drop focus so the global Space shortcut (Mark In/Out)
  // keeps working after scrubbing — a focused range input would otherwise swallow Space.
  const releaseAndBlur = (el: HTMLInputElement) => {
    commit();
    el.blur();
  };

  return (
    <div className="rounded-lg border border-secondary bg-secondary px-3 py-2.5">
      {/* Full-width scrub track with a draggable red thumb; left of the thumb (already played) is darker. */}
      <div className="relative h-5 w-full select-none">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-tertiary" />
        <div
          className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-quaternary"
          style={{ width: `${pct}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-600 shadow-md ring-1 ring-black/10 dark:border-gray-900"
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={minEpoch}
          max={liveEpoch}
          step={1}
          value={Math.round(displayValue)}
          disabled={isDisabled}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onPointerUp={(e) => releaseAndBlur(e.currentTarget)}
          onMouseUp={(e) => releaseAndBlur(e.currentTarget)}
          onTouchEnd={(e) => releaseAndBlur(e.currentTarget)}
          onKeyUp={commit}
          onBlur={commit}
          aria-label="Seek within the last hour"
          className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
        />
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <span className="shrink-0 text-[11px] font-medium text-tertiary tabular-nums">-1h</span>
        <div className="flex flex-1 items-center justify-center gap-2">
          <span className="text-xs font-medium text-secondary tabular-nums">{playheadLabel}</span>
          <span
            className={`text-[11px] font-semibold tabular-nums ${
              isLive ? "text-red-600 dark:text-red-400" : "text-amber-600"
            }`}
          >
            {behindLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setDragValue(null);
            setHeldValue(null);
            onGoLive();
          }}
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
  );
}
