/**
 * Resolve Whisper subtitle display language from editor subtitle config.
 * Keep in sync with immergo-vod-encoder-api/src/utils/subtitle-language-utils.js
 */

/** @type {Record<string, { name: string, hlsLanguage: string }>} */
const WHISPER_LANGUAGE_META = {
  en: { name: "English", hlsLanguage: "eng" },
  es: { name: "Spanish", hlsLanguage: "spa" },
  he: { name: "Hebrew", hlsLanguage: "heb" },
  ar: { name: "Arabic", hlsLanguage: "ara" },
  fr: { name: "French", hlsLanguage: "fra" },
  de: { name: "German", hlsLanguage: "deu" },
  pt: { name: "Portuguese", hlsLanguage: "por" },
  ru: { name: "Russian", hlsLanguage: "rus" },
  it: { name: "Italian", hlsLanguage: "ita" },
  ja: { name: "Japanese", hlsLanguage: "jpn" },
  zh: { name: "Chinese", hlsLanguage: "zho" },
  hi: { name: "Hindi", hlsLanguage: "hin" },
  tr: { name: "Turkish", hlsLanguage: "tur" },
  pl: { name: "Polish", hlsLanguage: "pol" },
  uk: { name: "Ukrainian", hlsLanguage: "ukr" },
  nl: { name: "Dutch", hlsLanguage: "nld" },
  ko: { name: "Korean", hlsLanguage: "kor" },
  vi: { name: "Vietnamese", hlsLanguage: "vie" },
  id: { name: "Indonesian", hlsLanguage: "ind" },
  el: { name: "Greek", hlsLanguage: "ell" },
  sv: { name: "Swedish", hlsLanguage: "swe" },
  da: { name: "Danish", hlsLanguage: "dan" },
  fi: { name: "Finnish", hlsLanguage: "fin" },
  cs: { name: "Czech", hlsLanguage: "ces" },
  hu: { name: "Hungarian", hlsLanguage: "hun" },
  ro: { name: "Romanian", hlsLanguage: "ron" },
};

const DEFAULT = { iso2: "en", name: "English", hlsLanguage: "eng" };

function whisperSubsConfigFromSpec(spec) {
  if (!spec || typeof spec !== "object") return null;
  const clips = Array.isArray(spec.clips) ? spec.clips : [];
  for (const clip of clips) {
    if (clip?.subtitles?.enabled) return clip.subtitles;
  }
  if (spec.subtitles?.enabled) return spec.subtitles;
  return null;
}

/**
 * @param {object | null | undefined} spec Editor spec
 * @returns {{ iso2: string, name: string, hlsLanguage: string }}
 */
export function resolveWhisperSubtitleLanguageFromSpec(spec) {
  return resolveWhisperSubtitleLanguage(whisperSubsConfigFromSpec(spec));
}

/**
 * @param {{ whisperSourceLanguage?: string, whisperOutputLanguage?: string } | null | undefined} config
 * @returns {{ iso2: string, name: string, hlsLanguage: string }}
 */
export function resolveWhisperSubtitleLanguage(config) {
  if (!config || typeof config !== "object") {
    return { ...DEFAULT };
  }

  const source = String(config.whisperSourceLanguage || "auto").trim() || "auto";
  const output = String(config.whisperOutputLanguage || "same").trim() || "same";

  /** @type {string} */
  let iso2 = DEFAULT.iso2;
  if (output !== "same") {
    iso2 = output;
  } else if (source !== "auto") {
    iso2 = source;
  }

  const meta = WHISPER_LANGUAGE_META[iso2] || DEFAULT;
  return {
    iso2,
    name: meta.name,
    hlsLanguage: meta.hlsLanguage,
  };
}
