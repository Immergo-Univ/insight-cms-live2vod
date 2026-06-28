import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import type { EditorSubtitleSettings } from "@/types/editor";
import { normalizeEditorSubtitleSettings } from "@/types/editor";
import { EditorSubtitleStyleFields } from "./editor-subtitle-style-fields";

type SubtitleModalDraft = ReturnType<typeof normalizeEditorSubtitleSettings>;

interface EditorSubtitleStyleModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settings: EditorSubtitleSettings;
  onSave: (next: EditorSubtitleSettings) => void;
}

/** Standalone style editor (prefer burn-in modal from clip row for normal workflow). */
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
            <div className="mt-4">
              <EditorSubtitleStyleFields
                style={draft.style}
                onChange={(style) => setDraft((d) => ({ ...d, style }))}
              />
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
