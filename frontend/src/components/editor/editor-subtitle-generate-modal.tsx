import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import { AppSelect } from "@/components/base/select/app-select";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import type { EditorSubtitleSettings } from "@/types/editor";
import { normalizeEditorSubtitleSettings } from "@/types/editor";
import {
  WHISPER_SOURCE_LANGUAGE_OPTIONS,
  whisperLanguageLabel,
  type WhisperLanguageCode,
} from "@/types/editor-whisper-languages";
import { selectedSubtitleLanguageCodes } from "@/utils/tenant-subtitle-defaults";

export interface EditorSubtitleGenerateSavePayload {
  generateEnabled: boolean;
  settings: EditorSubtitleSettings;
  subtitleLocales: Record<string, boolean>;
}

interface EditorSubtitleGenerateModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  generateEnabled: boolean;
  settings: EditorSubtitleSettings;
  subtitleLocales: Record<string, boolean>;
  availableLanguages: string[];
  onSave: (payload: EditorSubtitleGenerateSavePayload) => void;
}

export function EditorSubtitleGenerateModal({
  isOpen,
  onOpenChange,
  generateEnabled,
  settings,
  subtitleLocales,
  availableLanguages,
  onSave,
}: EditorSubtitleGenerateModalProps) {
  const [draft, setDraft] = useState(() => normalizeEditorSubtitleSettings(settings));
  const [localesDraft, setLocalesDraft] = useState<Record<string, boolean>>({});
  const [generationOn, setGenerationOn] = useState(generateEnabled);

  useEffect(() => {
    if (!isOpen) return;
    setGenerationOn(generateEnabled);
    setDraft(normalizeEditorSubtitleSettings(settings));
    const next: Record<string, boolean> = {};
    for (const code of availableLanguages) {
      next[code] = subtitleLocales[code] !== false;
    }
    setLocalesDraft(next);
  }, [isOpen, generateEnabled, settings, subtitleLocales, availableLanguages]);

  const selectedCount = selectedSubtitleLanguageCodes(localesDraft).length;
  const canApply = !generationOn || selectedCount > 0;

  const apply = () => {
    if (!canApply) return;
    onSave({ generateEnabled: generationOn, settings: draft, subtitleLocales: localesDraft });
    onOpenChange(false);
  };

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable isKeyboardDismissDisabled={false}>
      <Modal>
        <Dialog
          aria-label="Subtitle generation"
          className="mx-4 flex w-full max-w-lg justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
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
                <p className="text-xs font-medium text-secondary">Subtitle languages to generate</p>
                <p className="mt-0.5 text-[11px] text-tertiary">
                  All tenant languages are selected by default. Uncheck languages you do not need for this clip.
                </p>
                <div className="mt-3 flex max-h-48 flex-col gap-2 overflow-y-auto">
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

              <div className={`flex flex-col gap-4 ${!generationOn ? "pointer-events-none opacity-50" : ""}`}>
              <Checkbox
                size="sm"
                className="w-full min-w-0"
                isSelected={draft.transcribeSpeakerDiarization}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    transcribeSpeakerDiarization: v,
                    transcribeInferSpeakerNames: v ? d.transcribeInferSpeakerNames : false,
                  }))
                }
                label="Speaker detection (diarization)"
                hint="When on, OpenAI returns per-speaker turns for transcript and cues."
              />
              <Checkbox
                size="sm"
                className="w-full min-w-0"
                isSelected={draft.transcribeInferSpeakerNames}
                isDisabled={!draft.transcribeSpeakerDiarization}
                onChange={(v) => setDraft((d) => ({ ...d, transcribeInferSpeakerNames: v }))}
                label="Name speakers in subtitles"
              />

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Video language (speech)</span>
                <AppSelect
                  value={draft.whisperSourceLanguage}
                  onChange={(value) =>
                    setDraft((d) => ({
                      ...d,
                      whisperSourceLanguage: value as WhisperLanguageCode,
                    }))
                  }
                  aria-label="Video language"
                  options={WHISPER_SOURCE_LANGUAGE_OPTIONS.map((opt) => ({
                    value: opt.code,
                    label: opt.label,
                  }))}
                />
              </label>

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
              </label>
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
