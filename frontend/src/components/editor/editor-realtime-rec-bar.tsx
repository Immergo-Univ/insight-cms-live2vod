import { useMemo } from "react";
import type { EditorSubClip } from "@/types/editor";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";

interface EditorRealtimeRecBarProps {
  clips: EditorSubClip[];
  /** True between Mark In and Mark Out for the current REC segment (not mere list selection). */
  awaitingMarkOut: boolean;
  onRecPress: () => void;
  /** IANA zone from ?tz= (via useTimezone); drives wall-clock label. */
  timeZone: string;
  /** Bumps every second while realtime mode is active so the clock refreshes. */
  clockTick: number;
  isDisabled?: boolean;
  /** Queue whisper transcript on each completed REC segment (Mark Out). */
  transcribeOnRec: boolean;
  onTranscribeOnRecChange: (next: boolean) => void;
}

export function EditorRealtimeRecBar({
  clips,
  awaitingMarkOut,
  onRecPress,
  timeZone,
  clockTick,
  isDisabled,
  transcribeOnRec,
  onTranscribeOnRecChange,
}: EditorRealtimeRecBarProps) {
  const awaitingOut = awaitingMarkOut;
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
    <div
      className="rounded-lg border border-secondary bg-secondary px-3 py-3"
      data-editor-mark-in-out
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-secondary tabular-nums">
            Live — {liveNowLabel}
          </span>
          {awaitingOut ? (
            <span className="text-[11px] font-medium text-amber-600">
              Press REC or Space again for Mark Out — indicator shows on the preview while recording.
            </span>
          ) : (
            <span className="text-[11px] text-tertiary">
              REC or Space: Mark In, then again Mark Out. Clips: {clips.length}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <div
            className={cx(
              "flex max-w-[14rem] flex-col gap-0.5 rounded-lg border border-secondary bg-primary/40 px-2.5 py-2",
              isDisabled && "pointer-events-none opacity-50",
            )}
            data-no-row-select
            onClick={(e) => e.stopPropagation()}
          >
            <Toggle
              size="sm"
              slim
              isSelected={transcribeOnRec}
              onChange={onTranscribeOnRecChange}
              isDisabled={isDisabled}
              label="Transcribe"
              hint="After each clip, transcribe audio from the live stream (no video encode)."
            />
          </div>
          <button
            type="button"
            onClick={onRecPress}
            disabled={isDisabled}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-2 border-red-600 bg-red-600/15 px-4 py-2.5 text-sm font-bold tracking-wide text-red-700 transition-colors hover:bg-red-600/25 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
            aria-pressed={awaitingOut}
            aria-label={awaitingOut ? "Mark out (or press Space)" : "Mark in (or press Space)"}
            title={awaitingOut ? "Mark Out — or press Space" : "Mark In — or press Space"}
          >
            <span
              className={`size-2.5 rounded-full bg-red-600 ${awaitingOut ? "animate-pulse" : ""}`}
              aria-hidden
            />
            REC
          </button>
        </div>
      </div>
    </div>
  );
}
