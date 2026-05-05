import { useCallback, useMemo, useRef, useState } from "react";
import { Settings01 } from "@untitledui/icons";
import type { EditorSubClip } from "@/types/editor";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import {
  EditorTranscribeSettingsModal,
  type RealtimeTranscribeSettings,
} from "@/components/editor/editor-transcribe-settings-modal";
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
  transcribeSettings: RealtimeTranscribeSettings;
  onTranscribeSettingsChange: (next: RealtimeTranscribeSettings) => void;
  /** When false, hide transcribe queue UI (tenant disables subtitles / STT for realtime). */
  transcribeControlsEnabled?: boolean;
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
  transcribeSettings,
  onTranscribeSettingsChange,
  transcribeControlsEnabled = true,
}: EditorRealtimeRecBarProps) {
  const transcribeBoxRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /** REC / Space must work globally; the RAC checkbox keeps focus and steals Space — drop focus after toggle. */
  const releaseTranscribeControlFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && transcribeBoxRef.current?.contains(el)) {
        el.blur();
      }
    });
  }, []);

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
    <>
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
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3 sm:flex-none sm:max-w-none">
          {transcribeControlsEnabled ? (
            <div
              ref={transcribeBoxRef}
              className={cx(
                "flex min-w-0 max-w-full flex-1 rounded-lg border border-secondary bg-primary/40 px-3 py-2.5 sm:min-w-[20rem] sm:max-w-[26rem] sm:flex-none",
                isDisabled && "pointer-events-none opacity-50",
              )}
              data-no-row-select
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Checkbox
                    size="sm"
                    className="min-w-0 w-full max-w-full gap-3 sm:gap-4"
                    isSelected={transcribeOnRec}
                    onChange={(next) => {
                      onTranscribeOnRecChange(next);
                      releaseTranscribeControlFocus();
                    }}
                    isDisabled={isDisabled}
                    label="Transcribe"
                    hint="After each clip, transcribe audio from the live stream (no video encode)."
                  />
                </div>
                {transcribeOnRec ? (
                  <button
                    type="button"
                    data-no-row-select
                    title="Transcribe options"
                    aria-label="Transcribe options"
                    disabled={isDisabled}
                    onClick={() => setSettingsOpen(true)}
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary transition-colors hover:bg-secondary hover:text-fg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Settings01 className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
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
    {transcribeControlsEnabled ? (
      <EditorTranscribeSettingsModal
        isOpen={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={transcribeSettings}
        onSave={onTranscribeSettingsChange}
      />
    ) : null}
    </>
  );
}
