/**
 * Inworld TTS character usage rollup (characters synthesized → estimated USD).
 * Reported to the CMS backend as `ttsClipUsage` for credit accounting.
 */

/** Default USD per 1M characters. Override with INWORLD_TTS_USD_PER_1M_CHARS. */
const DEFAULT_INWORLD_TTS_USD_PER_1M_CHARS = 5;

/**
 * @param {number} n
 */
function roundUsd(n) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6;
}

/**
 * @param {number} characters
 * @returns {number}
 */
export function estimateTtsUsd(characters) {
  const raw = String(process.env.INWORLD_TTS_USD_PER_1M_CHARS || "").trim();
  const n = Number(raw);
  const rate = Number.isFinite(n) && n >= 0 ? n : DEFAULT_INWORLD_TTS_USD_PER_1M_CHARS;
  return roundUsd((Math.max(0, Number(characters) || 0) / 1e6) * rate);
}

/**
 * @param {Array<{ step?: string, model?: string, characters?: number, estimatedUsd?: number }>} steps
 */
export function buildTtsClipUsageReport(steps) {
  const list = Array.isArray(steps) ? steps : [];
  let totalCharacters = 0;
  let estimatedTotalUsd = 0;
  for (const s of list) {
    totalCharacters += typeof s.characters === "number" ? s.characters : 0;
    estimatedTotalUsd += typeof s.estimatedUsd === "number" ? s.estimatedUsd : 0;
  }
  return {
    version: 1,
    currency: "USD",
    steps: list,
    totalCharacters,
    estimatedTotalUsd: roundUsd(estimatedTotalUsd),
    pricingNote:
      "estimatedTotalUsd uses approximate Inworld TTS list prices; override with INWORLD_TTS_USD_PER_1M_CHARS",
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} a
 * @param {Record<string, unknown> | null | undefined} b
 */
export function mergeTtsClipUsageReports(a, b) {
  const sa = a && typeof a === "object" && Array.isArray(a.steps) ? a.steps : [];
  const sb = b && typeof b === "object" && Array.isArray(b.steps) ? b.steps : [];
  return buildTtsClipUsageReport([...sa, ...sb]);
}

/**
 * @param {object} p
 * @param {string} p.step
 * @param {string} p.model
 * @param {number} p.characters
 */
export function ttsUsageStepRow(p) {
  const characters = Math.max(0, Math.floor(Number(p.characters) || 0));
  return {
    step: String(p.step || "tts"),
    model: String(p.model || "").trim() || "inworld-tts-2",
    characters,
    estimatedUsd: estimateTtsUsd(characters),
  };
}
