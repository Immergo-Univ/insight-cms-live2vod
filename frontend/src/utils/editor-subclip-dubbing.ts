import type { EditorSubClipEncodeOptions } from "@/types/editor";
import type { WhisperLanguageCode } from "@/types/editor-whisper-languages";
import { selectedDubbingLanguageCodes } from "@/utils/tenant-dubbing-defaults";

export function clipDubbingEnabled(c: EditorSubClipEncodeOptions | undefined): boolean {
  return c?.dubbingEnabled === true;
}

export function clipHasSelectedDubbingLocales(c: EditorSubClipEncodeOptions | undefined): boolean {
  return selectedDubbingLanguageCodes(c?.dubbingLocales).length > 0;
}

export function resolveClipDubbingSourceLanguage(
  c: EditorSubClipEncodeOptions | undefined,
): WhisperLanguageCode {
  const raw = String(c?.dubbingSourceLanguage || "auto")
    .trim()
    .toLowerCase();
  if (!raw) return "auto";
  return raw as WhisperLanguageCode;
}
