/** Default tenant language pool when none configured. */
export const DEFAULT_TENANT_AVAILABLE_LANGUAGES = ["en", "es", "he"];

const VALID_LANG = /^[a-z]{2,3}$/;

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeAvailableLanguages(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_TENANT_AVAILABLE_LANGUAGES];
  const out = [];
  for (const item of raw) {
    const code = String(item || "")
      .trim()
      .toLowerCase();
    if (!code || code === "auto" || !VALID_LANG.test(code)) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out.length ? out : [...DEFAULT_TENANT_AVAILABLE_LANGUAGES];
}
