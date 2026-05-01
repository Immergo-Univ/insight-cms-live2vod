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
 * @param {Array<{ speaker: string, start: number, end: number, text: string }>} segments
 * @param {Record<string, string>} speakerLabels
 */
export function diarizedSegmentsToSrt(segments, speakerLabels = {}) {
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
    const body = `${name}: ${String(seg.text || "").trim()}`.replace(/\n/g, "\\N");
    blocks.push(`${n}\n${t0} --> ${t1}\n${body}`);
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
