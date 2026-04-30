/**
 * OpenAI Chat Completions: turn a live-TV ASR transcript into short news articles (EN / ES / HE).
 */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/** Keep user message within a safe size for mini models. */
const MAX_TRANSCRIPT_CHARS = 18_000;

const SYSTEM_PROMPT = `You are an experienced TV news editor. The user message contains a raw automatic transcript from a LIVE TV channel broadcast (speech-to-text). It may contain errors, repetitions, filler words, unrelated chatter, or garbled phrases.

Your task: write a concise, factual NEWS-STYLE article based only on what the transcript plausibly supports. If the audio is unclear or content is thin, say so briefly—do not invent facts, quotes, or events.

Style:
- Short headline is optional inside the body first line if natural.
- Use short paragraphs separated by a blank line.
- Attribute statements to "the broadcast" or named speakers only if the transcript clearly names them.

Output: return ONLY valid JSON with exactly three string keys:
- "en": full article in English
- "es": full article in Spanish
- "he": full article in Hebrew (modern Israeli news Hebrew)

No markdown code fences, no keys other than en, es, he.`;

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.model] default gpt-4o-mini
 * @param {string} opts.transcriptText
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ en: string, es: string, he: string }>}
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
        content: `Transcript (may be truncated to ${MAX_TRANSCRIPT_CHARS} characters):\n\n${text.slice(0, MAX_TRANSCRIPT_CHARS)}`,
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
    const en = typeof o.en === "string" ? o.en.trim() : "";
    const es = typeof o.es === "string" ? o.es.trim() : "";
    const he = typeof o.he === "string" ? o.he.trim() : "";
    if (!en && !es && !he) {
      throw new Error("OpenAI returned empty en, es, and he strings");
    }
    return { en, es, he };
  } catch (e) {
    if (e && typeof e === "object" && /** @type {any} */ (e).name === "AbortError") {
      throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
