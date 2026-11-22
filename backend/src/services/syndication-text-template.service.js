/**
 * Shared text helpers for syndication account templates.
 * Supported tokens: {title}, {short_description}, {long_description}.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string} template
 * @param {{ title?: string, description?: string }} meta
 */
export function applyTextTemplate(template, meta) {
  const title = asTrimmedString(meta?.title);
  const description = asTrimmedString(meta?.description);
  return String(template || "")
    .replaceAll("{title}", title)
    .replaceAll("{short_description}", description)
    .replaceAll("{long_description}", description)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Normalize a hashtag list: trim, prefix with #, strip inner spaces, dedupe.
 *
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {string[]}
 */
export function normalizeHashtags(raw, max = 30) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const cleaned = String(item ?? "")
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "");
    if (!cleaned) continue;
    const tag = `#${cleaned}`;
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Append hashtags that are not already in the text.
 *
 * @param {string} text
 * @param {string[]} hashtags
 */
export function appendHashtags(text, hashtags) {
  const base = String(text || "").trim();
  const missing = hashtags.filter((tag) => !base.toLowerCase().includes(tag.toLowerCase()));
  if (!missing.length) return base;
  return base ? `${base}\n\n${missing.join(" ")}` : missing.join(" ");
}
