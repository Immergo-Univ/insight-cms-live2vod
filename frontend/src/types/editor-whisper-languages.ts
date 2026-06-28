/**
 * Whisper.cpp -l language codes exposed in the editor (subset of supported IDs).
 * UI labels in English per project rules.
 */
export const WHISPER_SOURCE_LANGUAGE_OPTIONS = [
  { code: "auto" as const, label: "Auto-detect" },
  { code: "en" as const, label: "English" },
  { code: "es" as const, label: "Spanish" },
  { code: "he" as const, label: "Hebrew" },
  { code: "ar" as const, label: "Arabic" },
  { code: "fr" as const, label: "French" },
  { code: "de" as const, label: "German" },
  { code: "pt" as const, label: "Portuguese" },
  { code: "ru" as const, label: "Russian" },
  { code: "it" as const, label: "Italian" },
  { code: "ja" as const, label: "Japanese" },
  { code: "zh" as const, label: "Chinese" },
  { code: "hi" as const, label: "Hindi" },
  { code: "tr" as const, label: "Turkish" },
  { code: "pl" as const, label: "Polish" },
  { code: "uk" as const, label: "Ukrainian" },
  { code: "nl" as const, label: "Dutch" },
  { code: "ko" as const, label: "Korean" },
  { code: "vi" as const, label: "Vietnamese" },
  { code: "id" as const, label: "Indonesian" },
  { code: "el" as const, label: "Greek" },
  { code: "sv" as const, label: "Swedish" },
  { code: "da" as const, label: "Danish" },
  { code: "fi" as const, label: "Finnish" },
  { code: "cs" as const, label: "Czech" },
  { code: "hu" as const, label: "Hungarian" },
  { code: "ro" as const, label: "Romanian" },
] as const;

/** Human-readable label for a language code (excluding auto). */
export function whisperLanguageLabel(code: string): string {
  const c = code.trim().toLowerCase();
  const o = WHISPER_SOURCE_LANGUAGE_OPTIONS.find((x) => x.code === c);
  return o?.label ?? c;
}

export type WhisperLanguageCode = (typeof WHISPER_SOURCE_LANGUAGE_OPTIONS)[number]["code"];

/** Subtitle line language: match video, or a fixed language (no "auto" on output). */
export type WhisperSubtitleOutputLanguage = "same" | Exclude<WhisperLanguageCode, "auto">;

export const WHISPER_OUTPUT_LANGUAGE_OPTIONS: {
  code: WhisperSubtitleOutputLanguage;
  label: string;
}[] = [
  { code: "same", label: "Same as video language (transcription)" },
  ...WHISPER_SOURCE_LANGUAGE_OPTIONS.filter((o) => o.code !== "auto").map((o) => ({
    code: o.code as Exclude<WhisperLanguageCode, "auto">,
    label: o.label,
  })),
];

export function isValidWhisperSubtitlePair(
  source: WhisperLanguageCode,
  output: WhisperSubtitleOutputLanguage,
): boolean {
  if (output === "same") return true;
  if (output === "en") return true;
  return source === "auto" || source === output;
}

export function whisperSubtitlePairHint(
  source: WhisperLanguageCode,
  output: WhisperSubtitleOutputLanguage,
): string {
  if (output === "same") {
    return source === "auto"
      ? "Whisper detects the spoken language and writes subtitles in that language."
      : `Transcription with video language fixed to ${labelForCode(source)} (-l ${source}).`;
  }
  if (output === "en") {
    if (source === "en") return "English speech → English subtitles (transcription).";
    if (source === "auto") return "Auto-detect speech, then English subtitles (OpenAI translation).";
    return `Transcribe ${labelForCode(source)} audio, then English subtitles (OpenAI translation).`;
  }
  if (source === "auto") {
    return `Auto-detect speech, then translate subtitles to ${labelForCode(output)} (OpenAI).`;
  }
  if (source === output) {
    return `Transcription in ${labelForCode(output)}.`;
  }
  return `Whisper cannot produce ${labelForCode(output)} subtitles from ${labelForCode(source)} audio. Use the same language for both, set video to Auto with one subtitle language, or choose English as subtitle language for translation.`;
}

function labelForCode(code: WhisperLanguageCode | WhisperSubtitleOutputLanguage): string {
  if (code === "same") return "video";
  const o = WHISPER_SOURCE_LANGUAGE_OPTIONS.find((x) => x.code === code);
  return o?.label ?? code;
}
