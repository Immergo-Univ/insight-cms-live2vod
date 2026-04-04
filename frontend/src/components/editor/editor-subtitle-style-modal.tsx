import { useEffect, useState } from "react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import type { EditorSubtitleSettings } from "@/types/editor";
import {
  WHISPER_OUTPUT_LANGUAGE_OPTIONS,
  WHISPER_SOURCE_LANGUAGE_OPTIONS,
  isValidWhisperSubtitlePair,
  whisperSubtitlePairHint,
  type WhisperLanguageCode,
  type WhisperSubtitleOutputLanguage,
} from "@/types/editor-whisper-languages";

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
  const [draft, setDraft] = useState<EditorSubtitleSettings>(settings);

  useEffect(() => {
    if (isOpen) setDraft(settings);
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
              Used when burning subtitles into the final video (whisper.cpp + ffmpeg). Whisper can translate
              to English only; other combinations must use the same language on both sides (or Auto + one
              subtitle language).
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Video language (speech)</span>
                <select
                  value={draft.whisperSourceLanguage}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      whisperSourceLanguage: e.target.value as WhisperLanguageCode,
                    }))
                  }
                  className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary"
                  aria-label="Video language"
                >
                  {WHISPER_SOURCE_LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-tertiary">
                  Passed to Whisper as <code className="rounded bg-secondary px-1">-l</code>. Use a fixed
                  language when auto-detect is wrong (e.g. Hebrew).
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-secondary">Subtitle language (output)</span>
                <select
                  value={draft.whisperOutputLanguage}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      whisperOutputLanguage: e.target.value as WhisperSubtitleOutputLanguage,
                    }))
                  }
                  className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary"
                  aria-label="Subtitle language"
                >
                  {WHISPER_OUTPUT_LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span
                  className={`text-xs ${pairOk ? "text-tertiary" : "text-error-primary"}`}
                >
                  {pairHint}
                </span>
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
