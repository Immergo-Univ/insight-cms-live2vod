import { useEffect, useRef, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import {
  WHISPER_SOURCE_LANGUAGE_OPTIONS,
  whisperLanguageLabel,
  type WhisperLanguageCode,
} from "@/types/editor-whisper-languages";
import { selectedDubbingLanguageCodes } from "@/utils/tenant-dubbing-defaults";

export interface EditorDubbingSavePayload {
  dubbingEnabled: boolean;
  sourceLanguage: WhisperLanguageCode;
  dubbingLocales: Record<string, boolean>;
}

interface EditorDubbingModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  dubbingEnabled: boolean;
  sourceLanguage: WhisperLanguageCode;
  dubbingLocales: Record<string, boolean>;
  availableLanguages: string[];
  onSave: (payload: EditorDubbingSavePayload) => void;
}

export function EditorDubbingModal({
  isOpen,
  onOpenChange,
  dubbingEnabled,
  sourceLanguage,
  dubbingLocales,
  availableLanguages,
  onSave,
}: EditorDubbingModalProps) {
  const [localesDraft, setLocalesDraft] = useState<Record<string, boolean>>({});
  const [generationOn, setGenerationOn] = useState(dubbingEnabled);
  const [sourceDraft, setSourceDraft] = useState<WhisperLanguageCode>(sourceLanguage);

  // Initialize drafts only on the closed -> open transition. The parent (editor) re-renders on
  // every VOD jobs poll and passes freshly-built `dubbingLocales`/`availableLanguages` objects, so
  // re-syncing on those prop identities would clobber the user's in-progress checkbox edits.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setGenerationOn(dubbingEnabled);
      setSourceDraft(sourceLanguage || "auto");
      const next: Record<string, boolean> = {};
      for (const code of availableLanguages) {
        next[code] = dubbingLocales[code] === true;
      }
      setLocalesDraft(next);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, dubbingEnabled, sourceLanguage, dubbingLocales, availableLanguages]);

  const selectedCount = selectedDubbingLanguageCodes(localesDraft).length;
  const canApply = !generationOn || selectedCount > 0;

  const apply = () => {
    if (!canApply) return;
    onSave({
      dubbingEnabled: generationOn,
      sourceLanguage: sourceDraft,
      dubbingLocales: localesDraft,
    });
    onOpenChange(false);
  };

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable isKeyboardDismissDisabled={false}>
      <Modal>
        <Dialog
          aria-label="AI dubbing"
          className="mx-4 flex w-full max-w-md justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative w-full rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Dubbing (AI)</h2>
            <p className="mt-1 text-xs text-tertiary">
              Clones each speaker voice with Inworld, translates dialogue, and muxes extra audio tracks while
              keeping the original. Timing is fitted to the source segment durations.
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <Checkbox
                size="sm"
                className="w-full min-w-0"
                isSelected={generationOn}
                onChange={setGenerationOn}
                label="Generate AI dubbing tracks"
                hint="When off, no voice cloning or dubbed audio is produced for this clip."
              />

              <div className={`rounded-lg border border-secondary bg-secondary/30 px-3 py-3 ${!generationOn ? "opacity-50" : ""}`}>
                <label className="text-xs font-medium text-secondary" htmlFor="dubbing-source-lang">
                  Source language
                </label>
                <select
                  id="dubbing-source-lang"
                  disabled={!generationOn}
                  value={sourceDraft}
                  onChange={(e) => setSourceDraft(e.target.value as WhisperLanguageCode)}
                  className="mt-2 w-full border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                >
                  {WHISPER_SOURCE_LANGUAGE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={`rounded-lg border border-secondary bg-secondary/30 px-3 py-3 ${!generationOn ? "opacity-50" : ""}`}>
                <p className="text-xs font-medium text-secondary">Target languages</p>
                <p className="mt-0.5 text-[11px] text-tertiary">
                  Languages available for this tenant (from admin Dubbing tab). Each selected language becomes an
                  extra selectable audio track.
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
                  <p className="mt-2 text-xs text-error-primary">Select at least one dubbing target language.</p>
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
