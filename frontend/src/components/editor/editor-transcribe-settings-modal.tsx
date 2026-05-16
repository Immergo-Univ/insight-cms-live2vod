import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Checkbox } from "@/components/base/checkbox/checkbox";

export interface RealtimeTranscribeSettings {
  speakerDiarization: boolean;
  generateNews: boolean;
}

interface EditorTranscribeSettingsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  value: RealtimeTranscribeSettings;
  onSave: (next: RealtimeTranscribeSettings) => void;
}

export function EditorTranscribeSettingsModal({
  isOpen,
  onOpenChange,
  value,
  onSave,
}: EditorTranscribeSettingsModalProps) {
  const [draft, setDraft] = useState<RealtimeTranscribeSettings>(value);

  useEffect(() => {
    if (isOpen) setDraft(value);
  }, [isOpen, value]);

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Modal>
        <Dialog
          aria-label="Transcribe settings"
          className="mx-4 flex w-full max-w-md justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative w-full rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h3 className="pr-10 text-sm font-semibold text-primary">Transcribe settings</h3>
            <p className="mt-1 text-xs text-tertiary">
              Applied to the next segment transcribe job after REC (Mark Out). Stored for this browser session.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              <Checkbox
                size="sm"
                className="w-full min-w-0"
                isSelected={draft.speakerDiarization}
                onChange={(v) => setDraft((d) => ({ ...d, speakerDiarization: v }))}
                label="Speaker diarization"
                hint="When on, OpenAI returns per-speaker turns (slower / different pricing). When off, plain transcript only."
              />
              <Checkbox
                size="sm"
                className="w-full min-w-0"
                isSelected={draft.generateNews}
                onChange={(v) => setDraft((d) => ({ ...d, generateNews: v }))}
                label="News tabs"
                hint="When on, encoder drafts English, Spanish, and Hebrew news after STT. When off, transcript only."
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-secondary bg-secondary px-3 py-2 text-sm font-medium text-primary hover:bg-tertiary"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg border border-brand-solid bg-brand-solid px-3 py-2 text-sm font-medium text-white hover:opacity-95"
                onClick={() => {
                  onSave(draft);
                  onOpenChange(false);
                }}
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
