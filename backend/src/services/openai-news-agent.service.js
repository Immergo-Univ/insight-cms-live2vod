/**
 * OpenAI Chat Completions: turn a live-TV ASR transcript into structured news (EN / ES / HE).
 */

import {
  buildOpenAiClipUsageReport,
  normalizeUsageFromResponseJson,
  usageStepRow,
} from "../utils/openai-usage.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/** Keep user message within a safe size for mini models. */
const MAX_TRANSCRIPT_CHARS = 18_000;

const SYSTEM_PROMPT = `You are an experienced TV news editor. The user message contains a raw automatic transcript from a LIVE TV channel (speech-to-text). It may contain errors, repetitions, filler, or garbled phrases.

Your task: produce FINAL NEWS ARTIFACTS for publication—title, summary, poster caption, and body—using ONLY what the transcript plausibly supports. Do not invent facts, quotes, dates, or events.

CRITICAL — output must read as finished journalism, NOT as commentary on the transcript:
- FORBIDDEN: "the transcript says…", "in the transcription…", "they discussed…" as meta-frame, "se menciona…", "en la transcripción…", meta-summary of the act of speaking.
- REQUIRED: direct, declarative news voice; headline-quality title; body reads on-air or on a news site.

Per locale you MUST return four string fields (all non-null strings; use "" only if absolutely nothing can be said—then title still a short neutral line like "Audio unclear"):
- "title": concise headline (max ~120 chars).
- "description": 1–3 sentence lead / dek for social previews and under-headline summary (plain text, no HTML).
- "posterCaption": one line for under the hero image (credit, context, or kicker—plain text, no HTML).
- "htmlBody": main story as HTML only. Allowed tags: <p>, <strong>, <em>, <br/>, <ul>, <ol>, <li>. No attributes except optional class on <p>. No <a>, no <img>, no scripts, no inline styles. At least one <p>.

Style: active voice; present or near-present for live TV; name entities only when clearly supported.

Output: return ONLY valid JSON with exactly three object keys "en", "es", "he". Each value is an object with exactly the four string keys: title, description, posterCaption, htmlBody.

No markdown code fences, no other top-level keys.`;

/**
 * @param {string} html
 */
function stripScripts(html) {
  return String(html ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

/**
 * @param {string} html
 */
function stripTagsPlain(html) {
  return String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} html
 */
function sanitizeNewsHtmlBody(html) {
  let s = stripScripts(String(html ?? "").trim());
  s = s.replace(/\s+on\w+\s*=/gi, " data-removed=");
  if (!s) return "<p></p>";
  return s;
}

/**
 * @param {unknown} v
 * @returns {{ title: string, description: string, posterCaption: string, htmlBody: string }}
 */
function normalizeAiLocale(v) {
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) {
      return {
        title: "News",
        description: "",
        posterCaption: "",
        htmlBody: "<p></p>",
      };
    }
    const nl = t.indexOf("\n");
    const title = nl === -1 ? t.slice(0, 120) || "News" : t.slice(0, nl).trim().slice(0, 200) || "News";
    const rest = (nl === -1 ? t : t.slice(nl + 1)).trim();
    const paras = rest.split(/\n\s*\n/).filter(Boolean);
    const inner =
      paras.length > 0
        ? paras.map((p) => `<p>${escapeHtmlPlain(p).replace(/\n/g, "<br/>")}</p>`).join("")
        : `<p>${escapeHtmlPlain(rest || t).replace(/\n/g, "<br/>")}</p>`;
    return {
      title,
      description: "",
      posterCaption: "",
      htmlBody: inner || "<p></p>",
    };
  }
  if (!v || typeof v !== "object") {
    return { title: "News", description: "", posterCaption: "", htmlBody: "<p></p>" };
  }
  const o = /** @type {Record<string, unknown>} */ (v);
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 300) : "News";
  const description = typeof o.description === "string" ? o.description.trim() : "";
  const posterCaption = typeof o.posterCaption === "string" ? o.posterCaption.trim() : "";
  const htmlBody = sanitizeNewsHtmlBody(typeof o.htmlBody === "string" ? o.htmlBody : "");
  return { title, description, posterCaption, htmlBody };
}

/**
 * @param {string} s
 */
function escapeHtmlPlain(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {{ title: string, description: string, posterCaption: string, htmlBody: string }} b
 */
function legacyPlainFromBlock(b) {
  const bodyPlain = stripTagsPlain(b.htmlBody);
  return [b.title, b.description, b.posterCaption, bodyPlain].filter((x) => x && String(x).trim()).join("\n\n");
}

/**
 * @param {string} iso
 * @returns {{ date: string, time: string }}
 */
function wallPartsFromIso(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) {
    const n = new Date();
    return { date: n.toISOString().slice(0, 10), time: n.toTimeString().slice(0, 5) };
  }
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toTimeString().slice(0, 5),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.model] default gpt-4o-mini
 * @param {string} opts.transcriptText
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{
 *   bundle: { version: number, en: object, es: object, he: object },
 *   legacyPlain: { en: string, es: string, he: string },
 *   openaiClipUsage: Record<string, unknown>
 * }>}
 */
export async function generateNewsArticlesFromTvTranscript(opts) {
  const { apiKey, model, transcriptText, timeoutMs = 120_000 } = opts;
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY is empty");

  const text = String(transcriptText || "").trim();
  if (!text) throw new Error("Empty transcript");

  const body = {
    model: (model && model.trim()) || "gpt-4o-mini",
    temperature: 0.35,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Source material — raw transcript only (may be truncated to ${MAX_TRANSCRIPT_CHARS} characters). Use it internally; your JSON must be standalone news with NO reference to a transcript or "mentions".\n\n${text.slice(0, MAX_TRANSCRIPT_CHARS)}`,
      },
    ],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`OpenAI HTTP ${res.status}: ${raw.slice(0, 500)}`);
    }
    /** @type {unknown} */
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("OpenAI response was not valid JSON");
    }
    const usageNorm = normalizeUsageFromResponseJson(data);
    const content = /** @type {any} */ (data)?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("OpenAI response missing assistant message content");
    }
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(content.trim());
    } catch {
      throw new Error("Assistant content was not valid JSON");
    }
    const o = /** @type {Record<string, unknown>} */ (parsed && typeof parsed === "object" ? parsed : {});
    const en = normalizeAiLocale(o.en);
    const es = normalizeAiLocale(o.es);
    const he = normalizeAiLocale(o.he);
    if (
      !stripTagsPlain(en.htmlBody) &&
      !stripTagsPlain(es.htmlBody) &&
      !stripTagsPlain(he.htmlBody)
    ) {
      throw new Error("OpenAI returned empty htmlBody for all locales");
    }
    const datelineIso = new Date().toISOString();
    const { date, time } = wallPartsFromIso(datelineIso);
    const block = (loc) => ({
      ...loc,
      date,
      time,
      posterUrl: null,
      posterDataUrl: null,
    });
    const bundle = {
      version: 1,
      en: block(en),
      es: block(es),
      he: block(he),
    };
    const legacyPlain = {
      en: legacyPlainFromBlock(en),
      es: legacyPlainFromBlock(es),
      he: legacyPlainFromBlock(he),
    };
    const openaiClipUsage = buildOpenAiClipUsageReport([
      usageStepRow({
        step: "news_trilingual_chat",
        model: body.model,
        usage: usageNorm,
      }),
    ]);
    return { bundle, legacyPlain, openaiClipUsage };
  } catch (e) {
    if (e && typeof e === "object" && /** @type {any} */ (e).name === "AbortError") {
      throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drop disabled locales from a trilingual news result (same API cost; unused payloads removed before PATCH).
 *
 * @param {{ bundle: object, legacyPlain: { en?: string, es?: string, he?: string }, openaiClipUsage?: object }} news
 * @param {{ en?: boolean; es?: boolean; he?: boolean }} [locales] when a key is strictly `false`, that locale is stripped
 * @returns {typeof news}
 */
export function filterTrilingualNewsByLocaleFlags(news, locales) {
  if (!news || typeof news !== "object" || !locales || typeof locales !== "object") {
    return news;
  }
  const prevBundle = news.bundle && typeof news.bundle === "object" ? news.bundle : {};
  /** @type {Record<string, unknown>} */
  const bundle = { ...prevBundle };
  const legacyPlain = {
    en: String(news.legacyPlain?.en ?? ""),
    es: String(news.legacyPlain?.es ?? ""),
    he: String(news.legacyPlain?.he ?? ""),
  };
  let touched = false;
  if (locales.en === false && bundle.en) {
    delete bundle.en;
    legacyPlain.en = "";
    touched = true;
  }
  if (locales.es === false && bundle.es) {
    delete bundle.es;
    legacyPlain.es = "";
    touched = true;
  }
  if (locales.he === false && bundle.he) {
    delete bundle.he;
    legacyPlain.he = "";
    touched = true;
  }
  if (!touched) return news;
  if (bundle.version == null) bundle.version = 1;
  return { ...news, bundle, legacyPlain };
}
