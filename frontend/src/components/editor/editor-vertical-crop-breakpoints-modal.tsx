import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash01 } from "@untitledui/icons";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Toggle } from "@/components/base/toggle/toggle";
import {
  dedupeVerticalBreakpointsByTime,
  normalizeEditorVerticalCropPanSettings,
  normalizeVerticalCropBreakpointsForClip,
  type EditorCropWindow,
  type EditorSubClip,
  type EditorVerticalCropBreakpoint,
  type EditorVerticalCropPanEasing,
  type EditorVerticalCropPanMode,
  type EditorVerticalCropPanSettings,
} from "@/types/editor";
import { cx } from "@/utils/cx";

interface EditorVerticalCropBreakpointsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clip: EditorSubClip | null;
  readOnly?: boolean;
  onSave: (
    clipId: string,
    patch: {
      verticalCropMode: boolean;
      cropWindow: EditorCropWindow | null;
      verticalCropBreakpoints: EditorVerticalCropBreakpoint[] | undefined;
      verticalCropPanSettings?: EditorVerticalCropPanSettings | undefined;
    },
  ) => void;
}

type DraftRow = {
  id: string;
  timeStr: string;
  centerX: number;
};

function breakpointsToDraftRows(bps: EditorVerticalCropBreakpoint[]): DraftRow[] {
  return dedupeVerticalBreakpointsByTime(bps).map((b) => ({
    id: b.id,
    timeStr: String(Number(b.timeSeconds.toFixed(3))),
    centerX: b.centerX,
  }));
}

function parseTimeSeconds(raw: string, maxSec: number): number | null {
  const t = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(t)) return null;
  return Math.min(Math.max(0, t), Math.max(0, maxSec));
}

export function EditorVerticalCropBreakpointsModal({
  isOpen,
  onOpenChange,
  clip,
  readOnly = false,
  onSave,
}: EditorVerticalCropBreakpointsModalProps) {
  const [verticalOn, setVerticalOn] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [panMode, setPanMode] = useState<EditorVerticalCropPanMode>("step");
  const [panEasing, setPanEasing] = useState<EditorVerticalCropPanEasing>("ease-in-out");
  const [motionSampleStr, setMotionSampleStr] = useState("0.12");

  const clipDuration = useMemo(() => {
    if (!clip) return 0;
    return Math.max(0, clip.endTime - clip.startTime);
  }, [clip]);

  useEffect(() => {
    if (!isOpen || !clip) return;
    setVerticalOn(!!clip.verticalCropMode);
    const bps = clip.verticalCropBreakpoints?.length
      ? clip.verticalCropBreakpoints
      : clip.cropWindow
        ? [
            {
              id: crypto.randomUUID(),
              timeSeconds: 0,
              centerX: clip.cropWindow.centerX,
            },
          ]
        : [{ id: crypto.randomUUID(), timeSeconds: 0, centerX: 0.5 }];
    setRows(breakpointsToDraftRows(bps));
    const pan = normalizeEditorVerticalCropPanSettings(clip.verticalCropPanSettings);
    setPanMode(pan.mode);
    setPanEasing(pan.easing);
    setMotionSampleStr(String(pan.motionSampleSec));
  }, [isOpen, clip]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleApply = useCallback(() => {
    if (!clip || readOnly) return;
    if (!verticalOn) {
      onSave(clip.id, {
        verticalCropMode: false,
        cropWindow: null,
        verticalCropBreakpoints: undefined,
        verticalCropPanSettings: undefined,
      });
      onOpenChange(false);
      return;
    }
    const fallback = clip.cropWindow?.centerX ?? 0.5;
    const parsed: EditorVerticalCropBreakpoint[] = [];
    for (const r of rows) {
      const ts = parseTimeSeconds(r.timeStr, clipDuration);
      if (ts === null) continue;
      parsed.push({ id: r.id, timeSeconds: ts, centerX: r.centerX });
    }
    const normalized = normalizeVerticalCropBreakpointsForClip(clipDuration, parsed, fallback);
    const cropWindow: EditorCropWindow = {
      aspectRatio: "9:16",
      centerX: normalized[0]?.centerX ?? fallback,
    };
    const motionParsed = Number(String(motionSampleStr).trim().replace(",", "."));
    const verticalCropPanSettings = normalizeEditorVerticalCropPanSettings({
      mode: panMode,
      easing: panEasing,
      motionSampleSec: Number.isFinite(motionParsed) ? motionParsed : 0.12,
    });
    onSave(clip.id, {
      verticalCropMode: true,
      cropWindow,
      verticalCropBreakpoints: normalized,
      verticalCropPanSettings,
    });
    onOpenChange(false);
  }, [
    clip,
    clipDuration,
    motionSampleStr,
    onOpenChange,
    onSave,
    panEasing,
    panMode,
    readOnly,
    rows,
    verticalOn,
  ]);

  const removeRow = useCallback(
    (id: string) => {
      if (readOnly || rows.length <= 1) return;
      setRows((prev) => prev.filter((r) => r.id !== id));
    },
    [readOnly, rows.length],
  );

  const updateTimeStr = useCallback((id: string, timeStr: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, timeStr } : r)));
  }, []);

  if (!clip) return null;

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      isKeyboardDismissDisabled={false}
    >
      <Modal>
        <Dialog
          aria-label="Vertical crop keyframes"
          className="mx-4 flex w-full max-w-lg justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Vertical video crop</h2>
            <p className="mt-1 text-xs text-tertiary">
              9:16 strip over the wide frame. Keyframes switch horizontal focus over this sub-clip (order #{clip.order}
              ). Scrub the timeline, then drag the strip in the player to add or update a keyframe at the playhead.
            </p>

            {readOnly ? (
              <p className="mt-3 rounded-lg border border-secondary bg-secondary px-3 py-2 text-xs text-secondary">
                This clip is encoding. Vertical crop cannot be changed until the job is cancelled or finished.
              </p>
            ) : null}

            <div className="mt-4">
              <Toggle
                label="9:16 vertical output"
                hint="When off, this clip exports full frame."
                isSelected={verticalOn}
                onChange={setVerticalOn}
                isDisabled={readOnly}
              />
            </div>

            {verticalOn ? (
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex flex-col gap-2 rounded-lg border border-secondary bg-secondary/20 p-3">
                  <span className="text-xs font-medium text-secondary">Motion between keyframes</span>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium text-tertiary">Pan style</span>
                    <select
                      value={panMode}
                      disabled={readOnly}
                      onChange={(e) => setPanMode(e.target.value as EditorVerticalCropPanMode)}
                      className={cx(
                        "rounded-md border border-secondary px-2 py-2 text-sm text-primary",
                        readOnly ? "cursor-not-allowed opacity-50" : "bg-primary",
                      )}
                    >
                      <option value="smooth">Smooth (interpolate)</option>
                      <option value="step">Step (hold until next keyframe)</option>
                    </select>
                  </label>
                  {panMode === "smooth" ? (
                    <>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium text-tertiary">Easing</span>
                        <select
                          value={panEasing}
                          disabled={readOnly}
                          onChange={(e) => setPanEasing(e.target.value as EditorVerticalCropPanEasing)}
                          className={cx(
                            "rounded-md border border-secondary px-2 py-2 text-sm text-primary",
                            readOnly ? "cursor-not-allowed opacity-50" : "bg-primary",
                          )}
                        >
                          <option value="ease-in-out">Ease-in-out</option>
                          <option value="linear">Linear</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium text-tertiary">
                          Encode motion sample (seconds)
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={motionSampleStr}
                          disabled={readOnly}
                          onChange={(e) => setMotionSampleStr(e.target.value)}
                          className={cx(
                            "rounded-md border border-secondary px-2 py-1.5 font-mono text-sm text-primary",
                            readOnly ? "cursor-not-allowed opacity-50" : "bg-primary",
                          )}
                          aria-label="Motion sample interval seconds"
                        />
                        <span className="text-[10px] text-tertiary">
                          Lower values follow the curve more closely (more ffmpeg segments). Range 0.03–2.0.
                        </span>
                      </label>
                    </>
                  ) : null}
                </div>

                <span className="text-xs font-medium text-secondary">Keyframes (seconds from Mark In)</span>
                <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-0.5">
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-row items-center gap-2 rounded-lg border border-secondary bg-secondary/30 px-2 py-2"
                    >
                      <label className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[10px] font-medium text-tertiary">Time (s)</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={r.timeStr}
                          disabled={readOnly}
                          onChange={(e) => updateTimeStr(r.id, e.target.value)}
                          className={cx(
                            "rounded-md border border-secondary px-2 py-1.5 font-mono text-sm text-primary",
                            readOnly ? "cursor-not-allowed opacity-50" : "bg-primary",
                          )}
                          aria-label={`Keyframe time ${r.id}`}
                        />
                      </label>
                      <span className="shrink-0 pt-4 text-[10px] text-tertiary tabular-nums">
                        centerX {r.centerX.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        disabled={readOnly || rows.length <= 1}
                        onClick={() => removeRow(r.id)}
                        title={rows.length <= 1 ? "At least one keyframe is required" : "Remove keyframe"}
                        className={cx(
                          "mt-4 flex size-8 shrink-0 items-center justify-center rounded-md border border-secondary transition-colors",
                          readOnly || rows.length <= 1
                            ? "cursor-not-allowed opacity-40"
                            : "cursor-pointer hover:bg-secondary text-fg-quaternary hover:text-fg-secondary",
                        )}
                        aria-label="Remove keyframe"
                      >
                        <Trash01 className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-tertiary">
                  Clip length: {clipDuration.toFixed(2)}s. Dragging the vertical window at a new timeline position
                  creates or updates the nearest keyframe.
                </p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-row justify-end gap-2 border-t border-secondary pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-secondary px-3 py-2 text-sm font-medium text-primary hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={handleApply}
                className={cx(
                  "rounded-lg px-3 py-2 text-sm font-medium text-white",
                  readOnly
                    ? "cursor-not-allowed bg-fg-disabled"
                    : "bg-brand-solid hover:bg-brand-solid-hover",
                )}
              >
                Save
              </button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
