import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import type { EditorSubtitleSettings } from "@/types/editor";
import { normalizeEditorSubtitleSettings } from "@/types/editor";

type SubtitleModalDraft = ReturnType<typeof normalizeEditorSubtitleSettings>;

interface EditorSubtitleStyleModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settings: EditorSubtitleSettings;
  onSave: (next: EditorSubtitleSettings) => void;
}

/** Quick preview styling only; generation, burn-in, and news are configured per clip elsewhere. */
export function EditorSubtitleStyleModal({
  isOpen,
  onOpenChange,
  settings,
  onSave,
}: EditorSubtitleStyleModalProps) {
  const [draft, setDraft] = useState<SubtitleModalDraft>(() => normalizeEditorSubtitleSettings(settings));

  useEffect(() => {
    if (isOpen) setDraft(normalizeEditorSubtitleSettings(settings));
  }, [isOpen, settings]);

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
    >
      <Modal>
        <Dialog
          aria-label="Subtitle appearance"
          className="mx-4 flex w-full max-w-lg justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Subtitle style</h2>
            <p className="mt-1 text-xs text-tertiary">
              Preview appearance for burned-in subtitles. Configure languages, VTT generation, and burn-in from the clip
              row controls.
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Font size (px)</span>
                <input
                  type="range"
                  min={12}
                  max={72}
                  value={draft.style.fontSizePx}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      style: { ...d.style, fontSizePx: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-brand-solid"
                />
                <span className="text-xs text-tertiary">{draft.style.fontSizePx}px</span>
              </label>

              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-secondary">Text color</span>
                  <input
                    type="color"
                    value={draft.style.textColor}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        style: { ...d.style, textColor: e.target.value },
                      }))
                    }
                    className="h-10 w-20 cursor-pointer rounded border border-secondary bg-primary"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-secondary">Outline color</span>
                  <input
                    type="color"
                    value={draft.style.outlineColor}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        style: { ...d.style, outlineColor: e.target.value },
                      }))
                    }
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
                  value={draft.style.outlineWidthPx}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      style: { ...d.style, outlineWidthPx: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-brand-solid"
                />
                <span className="text-xs text-tertiary">{draft.style.outlineWidthPx}px</span>
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
