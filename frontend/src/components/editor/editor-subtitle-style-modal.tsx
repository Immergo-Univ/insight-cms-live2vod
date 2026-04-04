import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import type { EditorSubtitleStyle } from "@/types/editor";

interface EditorSubtitleStyleModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  style: EditorSubtitleStyle;
  onSave: (next: EditorSubtitleStyle) => void;
}

export function EditorSubtitleStyleModal({
  isOpen,
  onOpenChange,
  style,
  onSave,
}: EditorSubtitleStyleModalProps) {
  const [draft, setDraft] = useState<EditorSubtitleStyle>(style);

  useEffect(() => {
    if (isOpen) setDraft(style);
  }, [isOpen, style]);

  const apply = () => {
    onSave(draft);
    onOpenChange(false);
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      isKeyboardDismissDisabled={false}
      className="z-[80]"
    >
      <Modal className="z-[81]">
        <Dialog
          aria-label="Subtitle appearance"
          className="mx-4 flex w-full max-w-md justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative w-full rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Subtitle style</h2>
            <p className="mt-1 text-xs text-tertiary">
              Used when burning subtitles into the final video (whisper + ffmpeg).
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Font size (px)</span>
                <input
                  type="range"
                  min={12}
                  max={72}
                  value={draft.fontSizePx}
                  onChange={(e) => setDraft((d) => ({ ...d, fontSizePx: Number(e.target.value) }))}
                  className="w-full accent-brand-solid"
                />
                <span className="text-xs text-tertiary">{draft.fontSizePx}px</span>
              </label>

              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-secondary">Text color</span>
                  <input
                    type="color"
                    value={draft.textColor}
                    onChange={(e) => setDraft((d) => ({ ...d, textColor: e.target.value }))}
                    className="h-10 w-20 cursor-pointer rounded border border-secondary bg-primary"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-secondary">Outline color</span>
                  <input
                    type="color"
                    value={draft.outlineColor}
                    onChange={(e) => setDraft((d) => ({ ...d, outlineColor: e.target.value }))}
                    className="h-10 w-20 cursor-pointer rounded border border-secondary bg-primary"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Outline width (px)</span>
                <input
                  type="range"
                  min={0}
                  max={12}
                  value={draft.outlineWidthPx}
                  onChange={(e) => setDraft((d) => ({ ...d, outlineWidthPx: Number(e.target.value) }))}
                  className="w-full accent-brand-solid"
                />
                <span className="text-xs text-tertiary">{draft.outlineWidthPx}px</span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover"
              >
                Apply
              </button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
