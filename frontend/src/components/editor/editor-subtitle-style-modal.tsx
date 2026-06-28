import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { Tabs } from "@/components/application/tabs/tabs";
import { CloseButton } from "@/components/base/buttons/close-button";
import { AppSelect } from "@/components/base/select/app-select";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import type { EditorSubtitleSettings } from "@/types/editor";
import {
  WHISPER_OUTPUT_LANGUAGE_OPTIONS,
  WHISPER_SOURCE_LANGUAGE_OPTIONS,
  isValidWhisperSubtitlePair,
  whisperSubtitlePairHint,
  type WhisperLanguageCode,
  type WhisperSubtitleOutputLanguage,
} from "@/types/editor-whisper-languages";
import { normalizeEditorSubtitleSettings } from "@/types/editor";

type SubtitleModalDraft = ReturnType<typeof normalizeEditorSubtitleSettings>;

interface EditorSubtitleStyleModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settings: EditorSubtitleSettings;
  onSave: (next: EditorSubtitleSettings) => void;
}

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

  const pairOk = isValidWhisperSubtitlePair(draft.whisperSourceLanguage, draft.whisperOutputLanguage);
  const pairHint = whisperSubtitlePairHint(draft.whisperSourceLanguage, draft.whisperOutputLanguage);

  const apply = () => {
    if (!isValidWhisperSubtitlePair(draft.whisperSourceLanguage, draft.whisperOutputLanguage)) {
      return;
    }
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
              Used when burning subtitles into the final video (OpenAI audio models + ffmpeg). The encoder can
              translate to English only; other combinations must use the same language on both sides (or Auto + one
              subtitle language).
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <Checkbox
                size="sm"
                className="w-full min-w-0"
                isSelected={draft.burnIn}
                onChange={(v) => setDraft((d) => ({ ...d, burnIn: v }))}
                label="Burn subtitles into video"
                hint="When on, the encoder embeds subtitles in the video pixels (ffmpeg). When off, only HLS sidecar tracks and the Subtitles asset are generated."
              />
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
                hint="When on, OpenAI returns per-speaker turns for transcript and burned cues (different pricing). When off, plain transcript only."
              />
              <Checkbox
                size="sm"
                className="w-full min-w-0"
                isSelected={draft.transcribeInferSpeakerNames}
                isDisabled={!draft.transcribeSpeakerDiarization}
                onChange={(v) => setDraft((d) => ({ ...d, transcribeInferSpeakerNames: v }))}
                label="Name speakers in subtitles"
                hint='When on, the encoder may infer display names and show "Name:" before each line in the burned video. When off, only the spoken text is shown (no "Speaker A" or id prefix), on at most two short lines per cue.'
              />

              <div className="rounded-lg border border-secondary bg-secondary/30 px-3 py-3">
                <p className="text-xs font-medium text-secondary">News generation after encode</p>
                <p className="mt-0.5 text-[11px] text-tertiary">
                  One OpenAI call produces all locales; disabled tabs are discarded before saving the job (API cost is
                  unchanged).
                </p>
                <Tabs defaultSelectedKey="en" className="mt-3 min-w-0 gap-2">
                  <Tabs.List
                    type="underline"
                    orientation="horizontal"
                    fullWidth
                    items={[
                      { id: "en", label: "English", children: "English" },
                      { id: "es", label: "Español", children: "Español" },
                      { id: "he", label: "עברית", children: "עברית" },
                    ]}
                  />
                  <Tabs.Panel id="en" className="pt-2" lang="en">
                    <Checkbox
                      size="sm"
                      className="w-full min-w-0"
                      isSelected={draft.transcribeNewsLocales.en}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          transcribeNewsLocales: { ...d.transcribeNewsLocales, en: v },
                        }))
                      }
                      label="Generate English news draft"
                      hint="Saves the English news card on the completed encode job when enabled."
                    />
                  </Tabs.Panel>
                  <Tabs.Panel id="es" className="pt-2" lang="es">
                    <Checkbox
                      size="sm"
                      className="w-full min-w-0"
                      isSelected={draft.transcribeNewsLocales.es}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          transcribeNewsLocales: { ...d.transcribeNewsLocales, es: v },
                        }))
                      }
                      label="Generar borrador de noticias en español"
                      hint="Guarda la tarjeta de noticias en español al completar el job de encode."
                    />
                  </Tabs.Panel>
                  <Tabs.Panel id="he" className="pt-2" dir="rtl" lang="he">
                    <Checkbox
                      size="sm"
                      className="w-full min-w-0"
                      isSelected={draft.transcribeNewsLocales.he}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          transcribeNewsLocales: { ...d.transcribeNewsLocales, he: v },
                        }))
                      }
                      label="יצירת טיוטת חדשות בעברית"
                      hint="שומר את כרטיס החדשות בעברית בסיום משימת הקידוד."
                    />
                  </Tabs.Panel>
                </Tabs>
              </div>

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
                <span className="text-xs text-tertiary">
                  Passed to the transcription API as the spoken-language hint. Use a fixed language when auto-detect is
                  wrong (e.g. Hebrew).
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Subtitle language (output)</span>
                <AppSelect
                  value={draft.whisperOutputLanguage}
                  onChange={(value) =>
                    setDraft((d) => ({
                      ...d,
                      whisperOutputLanguage: value as WhisperSubtitleOutputLanguage,
                    }))
                  }
                  aria-label="Subtitle language"
                  options={WHISPER_OUTPUT_LANGUAGE_OPTIONS.map((opt) => ({
                    value: opt.code,
                    label: opt.label,
                  }))}
                />
                <span className={`text-xs ${pairOk ? "text-tertiary" : "text-error-primary"}`}>{pairHint}</span>
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
                disabled={!pairOk}
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
