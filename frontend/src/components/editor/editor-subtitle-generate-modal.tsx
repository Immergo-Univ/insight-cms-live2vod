import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { whisperLanguageLabel } from "@/types/editor-whisper-languages";
import { selectedSubtitleLanguageCodes } from "@/utils/tenant-subtitle-defaults";

export interface EditorSubtitleGenerateSavePayload {
  generateEnabled: boolean;
  subtitleLocales: Record<string, boolean>;
}

interface EditorSubtitleGenerateModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  generateEnabled: boolean;
  subtitleLocales: Record<string, boolean>;
  availableLanguages: string[];
  onSave: (payload: EditorSubtitleGenerateSavePayload) => void;
}

export function EditorSubtitleGenerateModal({
  isOpen,
  onOpenChange,
  generateEnabled,
  subtitleLocales,
  availableLanguages,
  onSave,
}: EditorSubtitleGenerateModalProps) {
  const [localesDraft, setLocalesDraft] = useState<Record<string, boolean>>({});
  const [generationOn, setGenerationOn] = useState(generateEnabled);

  useEffect(() => {
    if (!isOpen) return;
    setGenerationOn(generateEnabled);
    const next: Record<string, boolean> = {};
    for (const code of availableLanguages) {
      next[code] = subtitleLocales[code] !== false;
    }
    setLocalesDraft(next);
  }, [isOpen, generateEnabled, subtitleLocales, availableLanguages]);

  const selectedCount = selectedSubtitleLanguageCodes(localesDraft).length;
  const canApply = !generationOn || selectedCount > 0;

  const apply = () => {
    if (!canApply) return;
    onSave({ generateEnabled: generationOn, subtitleLocales: localesDraft });
    onOpenChange(false);
  };

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable isKeyboardDismissDisabled={false}>
      <Modal>
        <Dialog
          aria-label="Subtitle generation"
          className="mx-4 flex w-full max-w-md justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative w-full rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Subtitles</h2>
            <p className="mt-1 text-xs text-tertiary">
              OpenAI STT generates sidecar VTT tracks for each selected language. Burn-in is configured separately.
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <Checkbox
                size="sm"
                className="w-full min-w-0"
                isSelected={generationOn}
                onChange={setGenerationOn}
                label="Generate subtitles (VTT)"
                hint="When off, no OpenAI STT or sidecar tracks are produced for this clip."
              />

              <div className={`rounded-lg border border-secondary bg-secondary/30 px-3 py-3 ${!generationOn ? "opacity-50" : ""}`}>
                <p className="text-xs font-medium text-secondary">Languages to generate</p>
                <p className="mt-0.5 text-[11px] text-tertiary">
                  Languages available for this tenant (from admin). Uncheck any you do not need for this clip.
                </p>
                <div className="mt-3 flex max-h-56 flex-col gap-2 overflow-y-auto">
                  {availableLanguages.map((code) => (
                    <Checkbox
                      key={code}
                      size="sm"
                      className="w-full min-w-0"
                      isSelected={localesDraft[code] === true}
                      isDisabled={!generationOn}
                      onChange={(v) => setLocalesDraft((prev) => ({ ...prev, [code]: v }))}
                      label={whisperLanguageLabel(code)}
                    />
                  ))}
                </div>
                {!canApply ? (
                  <p className="mt-2 text-xs text-error-primary">Select at least one subtitle language.</p>
                ) : null}
              </div>
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
                disabled={!canApply}
                className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover disabled:cursor-not-allowed disabled:opacity-50"
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
