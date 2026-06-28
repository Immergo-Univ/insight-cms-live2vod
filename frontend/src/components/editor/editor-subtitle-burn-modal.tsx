import { useEffect, useMemo, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import { AppSelect } from "@/components/base/select/app-select";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { whisperLanguageLabel } from "@/types/editor-whisper-languages";
import { selectedSubtitleLanguageCodes } from "@/utils/tenant-subtitle-defaults";

export interface EditorSubtitleBurnSavePayload {
  burnInEnabled: boolean;
  burnInLanguage: string;
}

interface EditorSubtitleBurnModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  burnInEnabled: boolean;
  burnInLanguage: string;
  subtitleLocales: Record<string, boolean>;
  onSave: (payload: EditorSubtitleBurnSavePayload) => void;
}

export function EditorSubtitleBurnModal({
  isOpen,
  onOpenChange,
  burnInEnabled,
  burnInLanguage,
  subtitleLocales,
  onSave,
}: EditorSubtitleBurnModalProps) {
  const selectedCodes = useMemo(() => selectedSubtitleLanguageCodes(subtitleLocales), [subtitleLocales]);
  const [burnOn, setBurnOn] = useState(burnInEnabled);
  const [lang, setLang] = useState(burnInLanguage);

  useEffect(() => {
    if (!isOpen) return;
    setBurnOn(burnInEnabled);
    const fallback = selectedCodes.includes(burnInLanguage) ? burnInLanguage : (selectedCodes[0] ?? "en");
    setLang(fallback);
  }, [isOpen, burnInEnabled, burnInLanguage, selectedCodes]);

  const apply = () => {
    onSave({ burnInEnabled: burnOn, burnInLanguage: lang });
    onOpenChange(false);
  };

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable isKeyboardDismissDisabled={false}>
      <Modal>
        <Dialog aria-label="Burn-in subtitles" className="mx-4 flex w-full max-w-md justify-center outline-hidden sm:mx-auto">
          <div className="relative w-full rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Burn-in subtitles</h2>
            <p className="mt-1 text-xs text-tertiary">
              Embed subtitles into the video pixels. Only available when subtitle generation is enabled for this clip.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              <Checkbox
                size="sm"
                isSelected={burnOn}
                onChange={setBurnOn}
                label="Burn subtitles into video"
                hint="When on, ffmpeg embeds one language into the encoded video."
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Burn-in language</span>
                <AppSelect
                  value={lang}
                  disabled={!burnOn || selectedCodes.length === 0}
                  onChange={setLang}
                  aria-label="Burn-in language"
                  options={selectedCodes.map((code) => ({
                    value: code,
                    label: whisperLanguageLabel(code),
                  }))}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white hover:bg-brand-solid-hover"
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
