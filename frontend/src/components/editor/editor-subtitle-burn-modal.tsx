import { useEffect, useMemo, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import { AppSelect } from "@/components/base/select/app-select";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import type { EditorSubtitleSettings } from "@/types/editor";
import { normalizeEditorSubtitleSettings } from "@/types/editor";
import { whisperLanguageLabel } from "@/types/editor-whisper-languages";
import { selectedSubtitleLanguageCodes } from "@/utils/tenant-subtitle-defaults";
import { EditorSubtitleStyleFields } from "./editor-subtitle-style-fields";

export interface EditorSubtitleBurnSavePayload {
  burnInEnabled: boolean;
  burnInLanguage: string;
  settings: EditorSubtitleSettings;
}

interface EditorSubtitleBurnModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  burnInEnabled: boolean;
  burnInLanguage: string;
  settings: EditorSubtitleSettings;
  subtitleLocales: Record<string, boolean>;
  onSave: (payload: EditorSubtitleBurnSavePayload) => void;
}

export function EditorSubtitleBurnModal({
  isOpen,
  onOpenChange,
  burnInEnabled,
  burnInLanguage,
  settings,
  subtitleLocales,
  onSave,
}: EditorSubtitleBurnModalProps) {
  const selectedCodes = useMemo(() => selectedSubtitleLanguageCodes(subtitleLocales), [subtitleLocales]);
  const [burnOn, setBurnOn] = useState(burnInEnabled);
  const [lang, setLang] = useState(burnInLanguage);
  const [draft, setDraft] = useState(() => normalizeEditorSubtitleSettings(settings));

  useEffect(() => {
    if (!isOpen) return;
    setBurnOn(burnInEnabled);
    setDraft(normalizeEditorSubtitleSettings(settings));
    const fallback = selectedCodes.includes(burnInLanguage) ? burnInLanguage : (selectedCodes[0] ?? "en");
    setLang(fallback);
  }, [isOpen, burnInEnabled, burnInLanguage, settings, selectedCodes]);

  const apply = () => {
    onSave({
      burnInEnabled: burnOn,
      burnInLanguage: lang,
      settings: { ...draft, burnInLanguage: lang },
    });
    onOpenChange(false);
  };

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable isKeyboardDismissDisabled={false}>
      <Modal>
        <Dialog
          aria-label="Burn-in subtitles"
          className="mx-4 flex w-full max-w-lg justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Burn-in subtitles</h2>
            <p className="mt-1 text-xs text-tertiary">
              Embed one language into the video. When enabled, the player preview shows sample subtitle styling.
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <Checkbox
                size="sm"
                className="w-full min-w-0"
                isSelected={burnOn}
                onChange={setBurnOn}
                label="Burn subtitles into video"
                hint="When on, ffmpeg embeds subtitles into the encoded MP4 using the style below."
              />

              <label className={`flex flex-col gap-1.5 ${!burnOn ? "opacity-50" : ""}`}>
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
                {selectedCodes.length === 0 ? (
                  <span className="text-xs text-tertiary">Enable subtitle generation and pick at least one VTT language first.</span>
                ) : null}
              </label>

              <div className="border-t border-secondary pt-4">
                <p className="text-xs font-medium text-secondary">Appearance</p>
                <p className="mt-0.5 text-[11px] text-tertiary">Matches the preview overlay on the player when burn-in is on.</p>
                <div className="mt-3">
                  <EditorSubtitleStyleFields
                    style={draft.style}
                    disabled={!burnOn}
                    onChange={(style) => setDraft((d) => ({ ...d, style }))}
                  />
                </div>
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
