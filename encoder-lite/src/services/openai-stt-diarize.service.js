/**
 * OpenAI gpt-4o-transcribe-diarize: speaker segments + optional name inference via Chat Completions.
 */

import fs from "fs/promises";
import { normalizeUsageFromResponseJson } from "../utils/openai-usage.js";

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/**
 * @param {string} model
 */
export function usesDiarizedSttModel(model) {
  return String(model || "").toLowerCase().includes("diarize");
}

/**
 * @param {string} speakerId
 */
export function defaultDisplayLabelForSpeakerId(speakerId) {
  const id = String(speakerId || "").trim();
  if (/^[A-Z]$/.test(id)) return `Speaker ${id}`;
  return id || "Speaker";
}

/**
 * @param {number} sec
 */
function secondsToSrtTimestamp(sec) {
  let ms = Math.max(0, Math.round(Number(sec) * 1000));
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const min = Math.floor(ms / 60000);
  ms -= min * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  const pad = (n, w) => String(n).padStart(w, "0");
  return `${pad(h, 2)}:${pad(min, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

/**
 * @param {Array<{ speaker: string, start: number, end: number, text: string }>} segments
 * @param {Record<string, string>} speakerLabels
 */
export function formatTranscriptDashLines(segments, speakerLabels = {}) {
  const labels = speakerLabels && typeof speakerLabels === "object" ? speakerLabels : {};
  return segments
    .map((seg) => {
      const id = String(seg.speaker || "").trim() || "A";
      const custom = labels[id]?.trim();
      const name = custom && custom.length > 0 ? custom : defaultDisplayLabelForSpeakerId(id);
      const line = String(seg.text || "")
        .trim()
        .replace(/\s*\n\s*/g, " ");
      return `- ${name}: ${line}`;
    })
    .join("\n\n");
}

/**
 * Wrap subtitle cue text to at most `maxLines` lines (SRT newlines) for readable burn-in.
 *
 * @param {string} text
 * @param {number} [maxCharsPerLine]
 * @param {number} [maxLines]
 */
export function wrapSubtitleCuePlainText(text, maxCharsPerLine = 36, maxLines = 2) {
  const rawWords = String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (rawWords.length === 0) return "";
  const L = Math.max(18, Math.floor(Number(maxCharsPerLine) || 36));
  const maxL = Math.max(1, Math.min(2, Math.floor(Number(maxLines) || 2)));

  /** Split oversize tokens so wrapping fits narrow burns (e.g. long Hebrew strings). */
  const words = rawWords.flatMap((w) => {
    if (w.length <= L) return [w];
    const chunks = [];
    for (let i = 0; i < w.length; i += L) chunks.push(w.slice(i, i + L));
    return chunks;
  });

  /** @param {number} start */
  const fillFrom = (start) => {
    let acc = "";
    let j = start;
    if (j >= words.length) return { line: "", idx: j };
    while (j < words.length) {
      const next = acc ? `${acc} ${words[j]}` : words[j];
      if (next.length <= L) {
        acc = next;
        j += 1;
      } else {
        if (acc) break;
        acc = words[j].length <= L ? words[j] : `${words[j].slice(0, Math.max(1, L - 1))}…`;
        j += 1;
        break;
      }
    }
    return { line: acc, idx: j };
  };

  const first = fillFrom(0);
  if (!first.line) {
    const w0 = words[0];
    return w0.length <= L ? w0 : `${w0.slice(0, Math.max(1, L - 1))}…`;
  }
  if (maxL === 1 || first.idx >= words.length) {
    if (first.idx < words.length) {
      const tail = words.slice(first.idx).join(" ");
      const merged = `${first.line} ${tail}`.trim();
      return merged.length <= L ? merged : `${first.line.slice(0, Math.max(1, L - 1))}…`;
    }
    return first.line;
  }

  const second = fillFrom(first.idx);
  let line2 = second.line;
  const restIdx = second.idx;
  if (restIdx < words.length && line2) {
    const tail = words.slice(restIdx).join(" ");
    const merged = `${line2} ${tail}`.trim();
    line2 =
      merged.length <= L ? merged : line2.length + 1 <= L ? `${line2}…` : `${line2.slice(0, Math.max(1, L - 1))}…`;
  }
  return line2 ? `${first.line}\n${line2}` : first.line;
}

/**
 * @param {Array<{ speaker: string, start: number, end: number, text: string }>} segments
 * @param {Record<string, string>} speakerLabels
 * @param {{ includeSpeakerLabel?: boolean }} [opts] when includeSpeakerLabel is not true, cue text is speech only (no "Speaker A:" prefix)
 */
export function diarizedSegmentsToSrt(segments, speakerLabels = {}, opts = {}) {
  const includeSpeakerLabel = opts.includeSpeakerLabel === true;
  const labels = speakerLabels && typeof speakerLabels === "object" ? speakerLabels : {};
  /** @type {string[]} */
  const blocks = [];
  let n = 1;
  for (const seg of segments) {
    const id = String(seg.speaker || "").trim() || "A";
    const custom = labels[id]?.trim();
    const name = custom && custom.length > 0 ? custom : defaultDisplayLabelForSpeakerId(id);
    const t0 = secondsToSrtTimestamp(Number(seg.start) || 0);
    const t1 = secondsToSrtTimestamp(Math.max(Number(seg.start) || 0, Number(seg.end) || 0));
    const rawText = String(seg.text || "").trim().replace(/\s+/g, " ");
    const body = includeSpeakerLabel ? `${name}: ${rawText}` : rawText;
    const escaped = body.replace(/\n/g, "\\N");
    blocks.push(`${n}\n${t0} --> ${t1}\n${escaped}`);
    n += 1;
  }
  return `${blocks.join("\n\n")}\n`;
}

/**
 * @param {string} raw
 * @returns {{ segments: Array<{ speaker: string, start: number, end: number, text: string }>, text?: string, usage: ReturnType<typeof normalizeUsageFromResponseJson> }}
 */
export function parseDiarizedJsonResponse(raw) {
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("OpenAI diarized response was not valid JSON");
  }
  const rawSegs = Array.isArray(data?.segments) ? data.segments : [];
  /** @type {Array<{ speaker: string, start: number, end: number, text: string }>} */
  const segments = [];
  for (const s of rawSegs) {
    const sp = String(s?.speaker ?? s?.speaker_id ?? "A").trim() || "A";
    const start = Number(s?.start);
    const end = Number(s?.end);
    const text = typeof s?.text === "string" ? s.text : "";
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    segments.push({ speaker: sp, start, end, text });
  }
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  const usage = normalizeUsageFromResponseJson(data);
  return { segments, text, usage };
}

/**
 * @param {object} opts
 * @param {string} opts.filePath
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string | null} opts.language
 * @param {AbortSignal} [opts.signal]
 */
export async function openaiTranscribeDiarizedOneFile(opts) {
  const { filePath, apiKey, model, language, signal } = opts;
  const buf = await fs.readFile(filePath);
  const base = (filePath.split(/[/\\]/).pop() || "audio.ogg").replace(/\.[^.]+$/, ".ogg");
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/ogg" }), base);
  form.append("model", model);
  form.append("response_format", "diarized_json");
  form.append("chunking_strategy", "auto");
  if (language && language.length === 2) {
    form.append("language", language);
  }
  const res = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI diarized STT HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  /** @type {{ segments: Array<{ speaker: string, start: number, end: number, text: string }>, text?: string, usage: ReturnType<typeof normalizeUsageFromResponseJson> }} */
  const parsed = parseDiarizedJsonResponse(raw);
  return parsed;
}

/**
 * Use a small chat model to map temporary speaker ids to names only when clearly stated in the text.
 *
 * @param {object} opts
 * @param {Array<{ speaker: string, text: string }>} opts.segments
 * @param {string} opts.apiKey
 * @param {string} opts.chatModel
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ speakerLabels: Record<string, string>, usage: ReturnType<typeof normalizeUsageFromResponseJson> }>}
 */
export async function inferSpeakerLabelsFromSegmentSamples(opts) {
  const { segments, apiKey, chatModel, signal } = opts;
  /** @type {Map<string, string[]>} */
  const by = new Map();
  for (const s of segments) {
    const id = String(s.speaker || "").trim();
    if (!id) continue;
    if (!by.has(id)) by.set(id, []);
    const arr = by.get(id);
    if (arr && arr.length < 4) arr.push(String(s.text || "").trim().slice(0, 400));
  }
  /** @type {Array<{ id: string, samples: string[] }>} */
  const payload = [];
  for (const [id, samples] of by) {
    payload.push({ id, samples });
  }
  if (payload.length === 0) return { speakerLabels: {}, usage: null };

  const body = {
    model: chatModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You map TV transcript speaker ids to human display names only when the speaker clearly states or is clearly introduced by name in the sample lines. Return JSON: {\"labels\":{ \"<id>\": \"Name\" or \"\" }}. Use empty string when unsure. Never invent. Preserve id keys exactly (including forms like c0_A).",
      },
      {
        role: "user",
        content: `Speaker samples (broadcast / interview context):\n${JSON.stringify(payload).slice(0, 14000)}`,
      },
    ],
  };
  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI speaker inference HTTP ${res.status}: ${raw.slice(0, 400)}`);
  }
  /** @type {any} */
  const data = JSON.parse(raw);
  const usage = normalizeUsageFromResponseJson(data);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { speakerLabels: {}, usage };
  try {
    /** @type {any} */
    const parsed = JSON.parse(content.trim());
    const labels = parsed?.labels && typeof parsed.labels === "object" ? parsed.labels : {};
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(labels)) {
      if (typeof v === "string" && v.trim()) out[String(k)] = v.trim();
    }
    return { speakerLabels: out, usage };
  } catch {
    return { speakerLabels: {}, usage };
  }
}

/** @type {Record<string, string>} */
const SUBTITLE_TRANSLATE_TARGET_NAMES = {
  en: "English",
  es: "Spanish",
  he: "Hebrew",
  ar: "Arabic",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
  it: "Italian",
  ja: "Japanese",
  zh: "Chinese",
  hi: "Hindi",
  tr: "Turkish",
  pl: "Polish",
  uk: "Ukrainian",
  nl: "Dutch",
  ko: "Korean",
  vi: "Vietnamese",
  id: "Indonesian",
  el: "Greek",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  cs: "Czech",
  hu: "Hungarian",
  ro: "Romanian",
};

/**
 * Translate parallel subtitle cue strings (same indices in / out) for burn + transcript.
 *
 * @param {object} opts
 * @param {Array<{ index: number, text: string }>} opts.items
 * @param {string} opts.targetIso639_1
 * @param {string} opts.apiKey
 * @param {string} opts.chatModel
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ texts: string[], usage: ReturnType<typeof normalizeUsageFromResponseJson> }>}
 */
export async function translateSubtitleCueTextsViaChat(opts) {
  const { items, targetIso639_1, apiKey, chatModel, signal } = opts;
  const lang = String(targetIso639_1 || "en")
    .trim()
    .toLowerCase();
  if (!lang || lang.length !== 2) {
    throw new Error("translateSubtitleCueTextsViaChat: invalid targetIso639_1");
  }
  const originals = (items || []).map((it) => String(it?.text ?? ""));
  const n = originals.length;
  if (n === 0) return { texts: [], usage: null };

  const targetLabel = SUBTITLE_TRANSLATE_TARGET_NAMES[lang] || lang;
  const payload = [];
  for (let j = 0; j < n; j++) {
    const t = originals[j].trim();
    if (t.length > 0) payload.push({ i: j, t: originals[j] });
  }
  if (payload.length === 0) {
    return { texts: [...originals], usage: null };
  }

  const chunkSize = 26;
  /** @type {string[]} */
  const out = [...originals];
  /** @type {ReturnType<typeof normalizeUsageFromResponseJson>} */
  let lastUsage = null;

  for (let off = 0; off < payload.length; off += chunkSize) {
    const batch = payload.slice(off, off + chunkSize);
    const body = {
      model: chatModel,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You translate TV/broadcast subtitle cue lines into ${targetLabel} (ISO 639-1: ${lang}). Return JSON only: {"items":[{"i":number,"t":"translated text"}]}. You MUST return one item per input line with the same "i". Preserve numbers and proper nouns when appropriate. Keep line breaks inside "t" as \\n when the source had multiple lines. Do not add speaker labels.`,
        },
        { role: "user", content: JSON.stringify({ lines: batch }) },
      ],
    };
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`OpenAI subtitle translate HTTP ${res.status}: ${raw.slice(0, 400)}`);
    }
    /** @type {any} */
    const data = JSON.parse(raw);
    lastUsage = normalizeUsageFromResponseJson(data);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") continue;
    try {
      /** @type {any} */
      const parsed = JSON.parse(content.trim());
      const arr = Array.isArray(parsed?.items) ? parsed.items : [];
      for (const row of arr) {
        const i = Number(row?.i);
        const t = typeof row?.t === "string" ? row.t : "";
        if (Number.isFinite(i) && i >= 0 && i < n && t) out[i] = t;
      }
    } catch {
      /* keep originals */
    }
  }
  return { texts: out, usage: lastUsage };
}

/**
 * Translate a plain transcript (e.g. non-diarized STT) into the subtitle output language.
 *
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} opts.targetIso639_1
 * @param {string} opts.apiKey
 * @param {string} opts.chatModel
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ text: string, usage: ReturnType<typeof normalizeUsageFromResponseJson> }>}
 */
export async function translatePlainTextViaChat(opts) {
  const { text, targetIso639_1, apiKey, chatModel, signal } = opts;
  const raw = String(text || "").trim();
  if (!raw) return { text: "", usage: null };
  const lang = String(targetIso639_1 || "en")
    .trim()
    .toLowerCase();
  const targetLabel = SUBTITLE_TRANSLATE_TARGET_NAMES[lang] || lang;
  const maxChunk = 3600;
  /** @type {string[]} */
  const chunks = [];
  let pos = 0;
  while (pos < raw.length) {
    let end = Math.min(raw.length, pos + maxChunk);
    if (end < raw.length) {
      const cut = raw.lastIndexOf("\n\n", end);
      if (cut > pos + 800) end = cut;
    }
    chunks.push(raw.slice(pos, end).trim());
    pos = end;
  }
  /** @type {string[]} */
  const parts = [];
  /** @type {ReturnType<typeof normalizeUsageFromResponseJson>} */
  let lastUsage = null;
  for (const ch of chunks) {
    if (!ch) continue;
    const body = {
      model: chatModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Translate the user's transcript into ${targetLabel} (${lang}). Return JSON: {"t":"translated text only"}. Preserve paragraph breaks as newlines. Do not add commentary or a title.`,
        },
        { role: "user", content: ch },
      ],
    };
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    const respText = await res.text();
    if (!res.ok) {
      throw new Error(`OpenAI plain translate HTTP ${res.status}: ${respText.slice(0, 400)}`);
    }
    /** @type {any} */
    const data = JSON.parse(respText);
    lastUsage = normalizeUsageFromResponseJson(data);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      parts.push(ch);
      continue;
    }
    try {
      /** @type {any} */
      const parsed = JSON.parse(content.trim());
      parts.push(typeof parsed?.t === "string" ? parsed.t : ch);
    } catch {
      parts.push(ch);
    }
  }
  return { text: parts.join("\n\n").trim(), usage: lastUsage };
}
