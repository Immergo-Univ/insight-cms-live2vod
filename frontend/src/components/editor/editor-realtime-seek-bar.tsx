import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildThumbnailUrl, COLUMN_WIDTH_PX } from "./editor-constants";

/** Seconds of tolerance to consider the real playhead as having caught up to a committed scrub. */
const CATCH_UP_TOLERANCE_SEC = 2;

/**
 * The archive window URL feeding historical thumbnails is anchored to this grid (seconds) so it
 * only changes every few minutes instead of every live tick, keeping thumbnail requests cached.
 */
const THUMB_WINDOW_ANCHOR_SEC = 300;

/** Minimum spacing (seconds) between historical thumbnail columns. */
const MIN_THUMB_COLUMN_SEC = 10;

/** Build an archive-window HLS URL (startTime/endTime wall-clock seconds) from a base stream URL. */
function buildWindowUrl(baseUrl: string, startUnix: number, endUnix: number): string {
  try {
    const u = new URL(baseUrl, typeof window !== "undefined" ? window.location.href : "http://localhost/");
    u.searchParams.set("startTime", String(startUnix));
    u.searchParams.set("endTime", String(endUnix));
    return u.toString();
  } catch {
    return baseUrl;
  }
}

/** Snap a raw column spacing to a human-friendly step so thumbnail epochs land on a stable grid. */
function niceColumnStepSec(rawSec: number): number {
  const steps = [10, 15, 30, 60, 120, 300, 600, 900, 1800];
  for (const s of steps) {
    if (rawSec <= s) return s;
  }
  return steps[steps.length - 1];
}

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
  /** Base stream URL (source m3u8) used to fetch historical thumbnails per archive window. */
  clipUrl?: string;
  /** Channel id forwarded to the thumbnail service. */
  channelId?: string;
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
  clipUrl,
  channelId,
  isDisabled,
}: EditorRealtimeSeekBarProps) {
  // While dragging we track the value locally and only commit onScrub on release, so the
  // player source is not swapped mid-drag (non-blocking scrub).
  const [dragValue, setDragValue] = useState<number | null>(null);
  // After releasing, the thumb stays pinned at the dropped position until the real playhead
  // catches up (the new archive window may still be loading), so it never snaps back.
  const [heldValue, setHeldValue] = useState<number | null>(null);
  // Preview line x (px within the band) while hovering, mirroring the editor timeline scrub strip.
  const [hoverX, setHoverX] = useState<number | null>(null);
  // Live edge frozen at the moment a scrub starts, so the window (and the "behind live" number)
  // stays fixed while dragging instead of jumping each 1s live tick.
  const [scrubLiveEpoch, setScrubLiveEpoch] = useState<number | null>(null);
  // Band width (px) drives how many historical thumbnail columns fit.
  const bandRef = useRef<HTMLDivElement>(null);
  const [bandWidth, setBandWidth] = useState(0);

  // While scrubbing use the frozen live edge; otherwise follow the live edge prop. The window
  // length is constant, so the min edge shifts by the same amount as the (frozen) live edge.
  const effectiveLive = scrubLiveEpoch ?? liveEpoch;
  const effectiveMin = minEpoch + (effectiveLive - liveEpoch);
  const clamp = (v: number) => Math.min(Math.max(v, effectiveMin), effectiveLive);
  const displayValue = clamp(dragValue ?? heldValue ?? playheadEpoch);
  const span = Math.max(1, effectiveLive - effectiveMin);
  const pct = Math.min(100, Math.max(0, ((displayValue - effectiveMin) / span) * 100));

  const isLive = mode === "live" && dragValue === null && heldValue === null;

  // Measure the band so the historical filmstrip uses roughly one thumbnail per column width.
  useLayoutEffect(() => {
    const el = bandRef.current;
    if (!el) return;
    setBandWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setBandWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Historical thumbnail columns across the DVR window. The archive window URL is anchored to a
  // coarse grid and each column samples a grid-aligned epoch, so URLs stay cached as time ticks.
  const thumbColumns = useMemo(() => {
    if (!clipUrl || !channelId || bandWidth <= 0) return [];
    const windowStart = Math.floor(effectiveMin / THUMB_WINDOW_ANCHOR_SEC) * THUMB_WINDOW_ANCHOR_SEC;
    const windowEnd = Math.ceil(effectiveLive / THUMB_WINDOW_ANCHOR_SEC) * THUMB_WINDOW_ANCHOR_SEC;
    const windowUrl = buildWindowUrl(clipUrl, windowStart, windowEnd);
    const targetColumns = Math.max(1, Math.round(bandWidth / COLUMN_WIDTH_PX));
    const stepSec = Math.max(MIN_THUMB_COLUMN_SEC, niceColumnStepSec(span / targetColumns));
    const widthPct = (stepSec / span) * 100;
    const out: Array<{ epoch: number; leftPct: number; widthPct: number; src: string }> = [];
    const first = Math.floor(effectiveMin / stepSec) * stepSec;
    for (let e = first; e < effectiveLive; e += stepSec) {
      const leftPct = ((e - effectiveMin) / span) * 100;
      if (leftPct + widthPct <= 0) continue;
      // Sample the frame at the column start; time is relative to the anchored window start.
      out.push({
        epoch: e,
        leftPct,
        widthPct,
        src: buildThumbnailUrl(windowUrl, Math.max(0, e - windowStart), channelId),
      });
    }
    return out;
  }, [clipUrl, channelId, bandWidth, effectiveMin, effectiveLive, span]);

  // Wall-clock time-axis ticks across the scrubbable window (like the timeline ruler).
  const ticks = useMemo(() => {
    const stepSec = (span <= 30 * 60 ? 5 : 10) * 60;
    const fmt = new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const out: Array<{ pct: number; label: string }> = [];
    const first = Math.ceil(effectiveMin / stepSec) * stepSec;
    for (let e = first; e <= effectiveLive; e += stepSec) {
      out.push({ pct: ((e - effectiveMin) / span) * 100, label: fmt.format(new Date(e * 1000)) });
    }
    return out;
  }, [effectiveMin, effectiveLive, span, timeZone]);

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

  // Sample the "behind live" delta once per whole-second live tick so steady window playback does
  // not sawtooth ±1s between the coarse 1s live clock and the smoother playhead clock.
  const displayValueRef = useRef(displayValue);
  displayValueRef.current = displayValue;
  const [tickBehindSeconds, setTickBehindSeconds] = useState(0);
  useEffect(() => {
    setTickBehindSeconds(Math.max(0, effectiveLive - displayValueRef.current));
  }, [effectiveLive]);

  // While scrubbing (or holding a committed position) the delta must follow the input immediately;
  // during steady playback use the per-tick sample so the number stays visually fixed.
  const isScrubbing = scrubLiveEpoch !== null || heldValue !== null;
  const behindSeconds = isScrubbing ? Math.max(0, effectiveLive - displayValue) : tickBehindSeconds;
  const behindLabel = isLive ? "LIVE" : formatBehind(behindSeconds);

  const commit = () => {
    setScrubLiveEpoch(null);
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
      {/* Time-selector scrub band (mirrors the editor-timeline-scroll scrub strip + filmstrip),
          carrying a single playback marker instead of a round thumb and no window selection. */}
      <div
        ref={bandRef}
        className="relative h-14 w-full cursor-crosshair select-none overflow-hidden rounded-md border border-secondary bg-secondary_alt/90"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHoverX(Math.max(0, Math.min(r.width, e.clientX - r.left)));
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        {/* Historical thumbnails for each part of the stream (DVR archive window). */}
        {thumbColumns.map((c) => (
          <div
            key={c.epoch}
            className="pointer-events-none absolute top-0 bottom-0 overflow-hidden bg-quaternary"
            style={{ left: `${c.leftPct}%`, width: `${c.widthPct}%` }}
            aria-hidden
          >
            <img src={c.src} alt="" loading="lazy" className="size-full object-cover" />
          </div>
        ))}

        {/* Wall-clock time ticks across the window. */}
        {ticks.map((t) => (
          <div
            key={t.pct}
            className="pointer-events-none absolute top-0 bottom-0"
            style={{ left: `${t.pct}%` }}
            aria-hidden
          >
            <div className="h-full w-px bg-white/40 mix-blend-overlay" />
            <span className="absolute left-1 top-0.5 whitespace-nowrap rounded-sm bg-black/55 px-1 text-[9px] leading-tight text-white tabular-nums">
              {t.label}
            </span>
          </div>
        ))}

        {/* Hover preview line. */}
        {hoverX !== null && !isDisabled && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-brand-secondary"
            style={{ left: hoverX, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.15)" }}
            aria-hidden
          />
        )}

        {/* Single playback marker: red line with triangular caps (same as the timeline playhead). */}
        <div
          className="pointer-events-none absolute top-0 z-[22] flex h-full flex-col items-center"
          style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
          aria-hidden
        >
          <div
            className="border-x-[5px] border-t-[6px] border-x-transparent border-t-red-500"
            style={{ width: 0, height: 0 }}
          />
          <div className="w-0.5 min-h-0 flex-1 shrink bg-red-500" />
          <div
            className="border-x-[5px] border-b-[6px] border-x-transparent border-b-red-500"
            style={{ width: 0, height: 0 }}
          />
        </div>

        {/* Transparent range input kept on top for click/drag/keyboard scrubbing. */}
        <input
          type="range"
          min={Math.round(effectiveMin)}
          max={Math.round(effectiveLive)}
          step={1}
          value={Math.round(displayValue)}
          disabled={isDisabled}
          onChange={(e) => {
            // Freeze the window on the first scrub movement so the delta/position stop jumping.
            setScrubLiveEpoch((prev) => prev ?? liveEpoch);
            setDragValue(Number(e.target.value));
          }}
          onPointerUp={(e) => releaseAndBlur(e.currentTarget)}
          onMouseUp={(e) => releaseAndBlur(e.currentTarget)}
          onTouchEnd={(e) => releaseAndBlur(e.currentTarget)}
          onKeyUp={commit}
          onBlur={commit}
          aria-label="Seek within the last hour"
          className="absolute inset-0 z-30 m-0 h-full w-full cursor-crosshair appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
        />
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <span className="shrink-0 text-[11px] font-medium text-tertiary tabular-nums">-1h</span>
        {/* Fixed-width slots so the numbers never reposition as their digit count changes. */}
        <div className="flex flex-1 items-center justify-center gap-2 tabular-nums">
          <span className="w-[104px] text-right text-xs font-medium text-secondary">
            {playheadLabel}
          </span>
          <span
            className={`w-[72px] text-left text-[11px] font-semibold ${
              isLive ? "text-red-600 dark:text-red-400" : "text-amber-600"
            }`}
          >
            {behindLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setScrubLiveEpoch(null);
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
