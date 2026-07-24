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

/**
 * @param {string} iso2
 * @returns {{ iso2: string, name: string, hlsLanguage: string }}
 */
export function whisperLanguageMeta(iso2) {
  const code = String(iso2 || "").trim().toLowerCase() || DEFAULT.iso2;
  const meta = WHISPER_LANGUAGE_META[code] || DEFAULT;
  return { iso2: code, name: meta.name, hlsLanguage: meta.hlsLanguage };
}

/**
 * Selected VTT locales from editor spec (multi-locale or legacy single language).
 * @param {object | null | undefined} spec
 * @returns {string[]}
 */
export function subtitleLanguagesFromSpec(spec) {
  if (!spec || typeof spec !== "object") return [DEFAULT.iso2];
  if (Array.isArray(spec.subtitleLanguages) && spec.subtitleLanguages.length > 0) {
    /** @type {string[]} */
    const out = [];
    for (const item of spec.subtitleLanguages) {
      const code = String(item || "")
        .trim()
        .toLowerCase();
      if (!code || code === "auto" || out.includes(code)) continue;
      out.push(code);
    }
    if (out.length) return out;
  }
  const cfg = whisperSubsConfigFromSpec(spec);
  if (cfg?.subtitleLocales && typeof cfg.subtitleLocales === "object") {
    /** @type {string[]} */
    const out = [];
    for (const [key, enabled] of Object.entries(cfg.subtitleLocales)) {
      if (enabled !== true) continue;
      const code = String(key || "")
        .trim()
        .toLowerCase();
      if (!code || out.includes(code)) continue;
      out.push(code);
    }
    if (out.length) return out;
  }
  return [resolveWhisperSubtitleLanguage(cfg).iso2];
}

/**
 * Guess ISO-639-1 from script in transcript text (Hebrew/Arabic/Cyrillic/CJK/…).
 * @param {string} text
 * @returns {string | null}
 */
export function detectLanguageIso2FromTranscriptText(text) {
  const sample = String(text || "").slice(0, 8000);
  if (!sample.trim()) return null;
  if (/[\u0590-\u05FF]/.test(sample)) return "he";
  if (/[\u0600-\u06FF]/.test(sample)) return "ar";
  if (/[\u0400-\u04FF]/.test(sample)) return "ru";
  if (/[\u3040-\u30FF]/.test(sample)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(sample)) return "ko";
  if (/[\u4E00-\u9FFF]/.test(sample)) return "zh";
  if (/[\u0E00-\u0E7F]/.test(sample)) return "th";
  if (/[\u0900-\u097F]/.test(sample)) return "hi";
  if (/[\u0370-\u03FF]/.test(sample)) return "el";
  return null;
}

/**
 * Language of the CMS transcript text (not burn-in / sidecar display language).
 * Prefers script detection, then whisperSourceLanguage, then subtitle output / default.
 *
 * @param {object | null | undefined} job
 * @returns {{ iso2: string, name: string, hlsLanguage: string }}
 */
export function resolveTranscriptLanguageFromJob(job) {
  const text = String(job?.transcriptText || "").trim();
  const fromScript = detectLanguageIso2FromTranscriptText(text);
  if (fromScript) return whisperLanguageMeta(fromScript);

  const spec = job?.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec : null;
  const cfg = whisperSubsConfigFromSpec(spec);
  const source = String(cfg?.whisperSourceLanguage || "auto").trim() || "auto";
  const output = String(cfg?.whisperOutputLanguage || "same").trim() || "same";

  if (output !== "same" && output !== "auto") return whisperLanguageMeta(output);
  if (source !== "auto") return whisperLanguageMeta(source);
  return resolveWhisperSubtitleLanguage(cfg);
}
