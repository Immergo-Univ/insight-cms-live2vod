/**
 * AI usage → USD → credits conversion.
 *
 * Credits are cost-weighted: each model (Whisper STT, LLM chat, TTS chars) has a different
 * USD price, so 1 raw token is NOT 1 credit. We convert via an anchor:
 *   credits = usd / usdPerCredit
 * where usdPerCredit defaults to $0.01 (env CREDIT_USD_VALUE).
 */

/** Default USD value of one credit. Override with CREDIT_USD_VALUE. */
const DEFAULT_USD_PER_CREDIT = 0.01;

/**
 * Approximate blended AI USD cost per minute of video (conservative full-stack reference).
 * Used only for UX equivalence ("credits ≈ X min of video"). Override with AI_USD_PER_VIDEO_MINUTE.
 */
const DEFAULT_AI_USD_PER_VIDEO_MINUTE = 0.05;

/**
 * Conservative USD / video-minute estimates per AI use (list-price padded, not exact billing).
 * Override via env when rates change.
 */
const DEFAULT_AI_USD_PER_MIN_STT = 0.012;
const DEFAULT_AI_USD_PER_MIN_LLM_NEWS = 0.005;
const DEFAULT_AI_USD_PER_MIN_VTT_PER_LANG = 0.003;
const DEFAULT_AI_USD_PER_MIN_DUBBING_PER_LANG = 0.015;

/**
 * Inworld TTS approximate list price (USD per 1M characters).
 * Override with INWORLD_TTS_USD_PER_1M_CHARS.
 */
const DEFAULT_INWORLD_TTS_USD_PER_1M_CHARS = 5;

/**
 * @param {string} name
 * @param {number} fallback
 */
function parsePositiveUsdEnv(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundUsd(n) {
  return Math.round(safeNumber(n) * 1e6) / 1e6;
}

/**
 * Credits are whole integers; always round up (ceil) when there is a fractional part.
 * Zero stays zero.
 *
 * @param {number} n
 * @returns {number}
 */
export function ceilCredits(n) {
  const v = safeNumber(n);
  if (v <= 0) return 0;
  return Math.ceil(v);
}

/**
 * @returns {number}
 */
export function usdPerCredit() {
  const raw = String(process.env.CREDIT_USD_VALUE || "").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_PER_CREDIT;
}

/**
 * Approximate AI USD cost for one minute of video (reference for minutes equivalence).
 * @returns {number}
 */
export function usdPerVideoMinute() {
  const raw = String(process.env.AI_USD_PER_VIDEO_MINUTE || "").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AI_USD_PER_VIDEO_MINUTE;
}

/**
 * @param {number} usd
 * @returns {number} integer credits (ceil)
 */
export function usdToCredits(usd) {
  const anchor = usdPerCredit();
  if (!(anchor > 0)) return 0;
  return ceilCredits(safeNumber(usd) / anchor);
}

/**
 * Approximate video minutes covered by an integer credit amount.
 * Rounded to 1 decimal for display (not ceiled — minutes are an estimate).
 *
 * @param {number} credits
 * @returns {number}
 */
export function creditsToApproxVideoMinutes(credits) {
  const perMin = usdPerVideoMinute();
  const creditUsd = usdPerCredit();
  if (!(perMin > 0) || !(creditUsd > 0)) return 0;
  const minutes = (ceilCredits(credits) * creditUsd) / perMin;
  return Math.round(minutes * 10) / 10;
}

/**
 * Minutes of video covered by 1 credit at a given USD/min rate.
 *
 * @param {number} usdPerMinute
 * @returns {number}
 */
export function minutesPerCreditAtRate(usdPerMinute) {
  const rate = safeNumber(usdPerMinute);
  const creditUsd = usdPerCredit();
  if (!(rate > 0) || !(creditUsd > 0)) return 0;
  return Math.round((creditUsd / rate) * 10) / 10;
}

/**
 * Build the admin UX table: how many video minutes 1 credit buys for each AI use.
 * VTT and dubbing costs scale with the tenant's configured language pools.
 *
 * @param {object} [opts]
 * @param {number} [opts.vttLanguageCount] availableLanguages length (VTT / news pool)
 * @param {number} [opts.dubbingLanguageCount] availableDubbingLanguages length
 * @returns {Array<{
 *   use: 'stt' | 'llm_news' | 'vtt_translate' | 'dubbing',
 *   languageCount: number | null,
 *   usdPerMinute: number,
 *   usdPerMinutePerLanguage: number | null,
 *   minutesPerCredit: number,
 * }>}
 */
export function buildCreditMinutesByUseTable(opts = {}) {
  const vttLangs = Math.max(1, Math.floor(safeNumber(opts.vttLanguageCount) || 1));
  const dubLangs = Math.max(1, Math.floor(safeNumber(opts.dubbingLanguageCount) || 1));

  const sttPerMin = parsePositiveUsdEnv("AI_USD_PER_MIN_STT", DEFAULT_AI_USD_PER_MIN_STT);
  const newsPerMin = parsePositiveUsdEnv("AI_USD_PER_MIN_LLM_NEWS", DEFAULT_AI_USD_PER_MIN_LLM_NEWS);
  const vttPerLang = parsePositiveUsdEnv("AI_USD_PER_MIN_VTT_PER_LANG", DEFAULT_AI_USD_PER_MIN_VTT_PER_LANG);
  const dubPerLang = parsePositiveUsdEnv(
    "AI_USD_PER_MIN_DUBBING_PER_LANG",
    DEFAULT_AI_USD_PER_MIN_DUBBING_PER_LANG,
  );

  const vttTotal = roundUsd(vttPerLang * vttLangs);
  const dubTotal = roundUsd(dubPerLang * dubLangs);

  return [
    {
      use: "stt",
      languageCount: null,
      usdPerMinute: sttPerMin,
      usdPerMinutePerLanguage: null,
      minutesPerCredit: minutesPerCreditAtRate(sttPerMin),
    },
    {
      use: "llm_news",
      languageCount: null,
      usdPerMinute: newsPerMin,
      usdPerMinutePerLanguage: null,
      minutesPerCredit: minutesPerCreditAtRate(newsPerMin),
    },
    {
      use: "vtt_translate",
      languageCount: vttLangs,
      usdPerMinute: vttTotal,
      usdPerMinutePerLanguage: vttPerLang,
      minutesPerCredit: minutesPerCreditAtRate(vttTotal),
    },
    {
      use: "dubbing",
      languageCount: dubLangs,
      usdPerMinute: dubTotal,
      usdPerMinutePerLanguage: dubPerLang,
      minutesPerCredit: minutesPerCreditAtRate(dubTotal),
    },
  ];
}

/**
 * @param {number} characters
 * @returns {number}
 */
export function estimateTtsUsd(characters) {
  const raw = String(process.env.INWORLD_TTS_USD_PER_1M_CHARS || "").trim();
  const n = Number(raw);
  const rate = Number.isFinite(n) && n >= 0 ? n : DEFAULT_INWORLD_TTS_USD_PER_1M_CHARS;
  return roundUsd((Math.max(0, safeNumber(characters)) / 1e6) * rate);
}

/**
 * Classify an OpenAI usage step into whisper | llm (TTS is separate via ttsClipUsage).
 *
 * @param {string} step
 * @param {string} model
 * @returns {'whisper' | 'llm'}
 */
export function classifyOpenAiStepCategory(step, model) {
  const s = String(step || "")
    .trim()
    .toLowerCase();
  const m = String(model || "")
    .trim()
    .toLowerCase();
  if (
    s.includes("stt") ||
    s.includes("transcribe") ||
    s.includes("diarize") ||
    m.includes("transcribe") ||
    m.includes("whisper")
  ) {
    return "whisper";
  }
  return "llm";
}

/**
 * Aggregate openaiClipUsage + ttsClipUsage into per-(category, model) rows with credits.
 *
 * @param {Record<string, unknown> | null | undefined} openaiClipUsage
 * @param {Record<string, unknown> | null | undefined} ttsClipUsage
 * @returns {Array<{
 *   category: 'whisper' | 'llm' | 'tts',
 *   model: string,
 *   units: number,
 *   unitKind: 'tokens' | 'characters',
 *   usd: number,
 *   credits: number,
 *   approxUsdPerUnit: number,
 * }>}
 */
export function summarizeAiUsageByModel(openaiClipUsage, ttsClipUsage) {
  /** @type {Map<string, { category: 'whisper'|'llm'|'tts', model: string, units: number, unitKind: 'tokens'|'characters', usd: number }>} */
  const map = new Map();

  const bump = (category, model, units, unitKind, usd) => {
    const m = String(model || "").trim() || "unknown";
    const key = `${category}::${m}::${unitKind}`;
    const prev = map.get(key) || { category, model: m, units: 0, unitKind, usd: 0 };
    prev.units += Math.max(0, safeNumber(units));
    prev.usd += Math.max(0, safeNumber(usd));
    map.set(key, prev);
  };

  if (openaiClipUsage && typeof openaiClipUsage === "object" && !Array.isArray(openaiClipUsage)) {
    const steps = Array.isArray(openaiClipUsage.steps) ? openaiClipUsage.steps : [];
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const model = String(/** @type {{ model?: string }} */ (step).model || "").trim();
      const stepName = String(/** @type {{ step?: string }} */ (step).step || "").trim();
      const category = classifyOpenAiStepCategory(stepName, model);
      const tokens = safeNumber(/** @type {{ totalTokens?: number }} */ (step).totalTokens);
      const audioSeconds = safeNumber(/** @type {{ audioSeconds?: number }} */ (step).audioSeconds);
      // Whisper-1 duration steps may have 0 tokens; count audio seconds as units fallback.
      const units = tokens > 0 ? tokens : audioSeconds > 0 ? audioSeconds : 0;
      const usd = safeNumber(/** @type {{ estimatedUsd?: number }} */ (step).estimatedUsd);
      if (units <= 0 && usd <= 0) continue;
      bump(category, model || (category === "whisper" ? "whisper" : "llm"), units, "tokens", usd);
    }
  }

  if (ttsClipUsage && typeof ttsClipUsage === "object" && !Array.isArray(ttsClipUsage)) {
    const steps = Array.isArray(ttsClipUsage.steps) ? ttsClipUsage.steps : [];
    if (steps.length > 0) {
      for (const step of steps) {
        if (!step || typeof step !== "object") continue;
        const model = String(/** @type {{ model?: string }} */ (step).model || "inworld-tts-2").trim();
        const chars = safeNumber(
          /** @type {{ characters?: number }} */ (step).characters ??
            /** @type {{ totalCharacters?: number }} */ (step).totalCharacters,
        );
        let usd = safeNumber(/** @type {{ estimatedUsd?: number }} */ (step).estimatedUsd);
        if (usd <= 0 && chars > 0) usd = estimateTtsUsd(chars);
        if (chars <= 0 && usd <= 0) continue;
        bump("tts", model, chars, "characters", usd);
      }
    } else {
      const chars = safeNumber(/** @type {{ totalCharacters?: number }} */ (ttsClipUsage).totalCharacters);
      let usd = safeNumber(/** @type {{ estimatedTotalUsd?: number }} */ (ttsClipUsage).estimatedTotalUsd);
      if (usd <= 0 && chars > 0) usd = estimateTtsUsd(chars);
      if (chars > 0 || usd > 0) {
        bump("tts", "inworld-tts-2", chars, "characters", usd);
      }
    }
  }

  return Array.from(map.values())
    .map((row) => {
      const usd = roundUsd(row.usd);
      const units = Math.round(row.units * 10000) / 10000;
      const credits = usdToCredits(usd);
      const approxUsdPerUnit = units > 0 ? roundUsd(usd / units) : 0;
      return {
        category: row.category,
        model: row.model,
        units,
        unitKind: row.unitKind,
        usd,
        credits,
        approxUsdPerUnit,
      };
    })
    .sort((a, b) => {
      const catOrder = { whisper: 0, llm: 1, tts: 2 };
      const ca = catOrder[a.category] ?? 9;
      const cb = catOrder[b.category] ?? 9;
      if (ca !== cb) return ca - cb;
      return a.model.localeCompare(b.model);
    });
}

/**
 * Sum credits / usd / tokens from summarizeAiUsageByModel rows.
 *
 * @param {ReturnType<typeof summarizeAiUsageByModel>} rows
 */
export function aggregateUsageRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  /** @type {{ whisper: number, llm: number, tts: number }} */
  const byCategory = { whisper: 0, llm: 0, tts: 0 };
  let totalCredits = 0;
  let totalUsd = 0;
  let totalTokens = 0;
  for (const r of list) {
    totalCredits += safeNumber(r.credits);
    totalUsd += safeNumber(r.usd);
    if (r.unitKind === "tokens") totalTokens += safeNumber(r.units);
    if (r.category === "whisper" || r.category === "llm" || r.category === "tts") {
      byCategory[r.category] += safeNumber(r.credits);
    }
  }
  const whisper = ceilCredits(byCategory.whisper);
  const llm = ceilCredits(byCategory.llm);
  const tts = ceilCredits(byCategory.tts);
  // Prefer sum of per-category ceil so category rows and total stay consistent integers.
  const total = ceilCredits(whisper + llm + tts > 0 ? whisper + llm + tts : totalCredits);
  return {
    byCategory: { whisper, llm, tts },
    totalCredits: total,
    totalUsd: roundUsd(totalUsd),
    totalTokens: Math.round(totalTokens),
    approxVideoMinutes: creditsToApproxVideoMinutes(total),
    usdPerVideoMinute: usdPerVideoMinute(),
    approxMinutesPerCredit: creditsToApproxVideoMinutes(1),
  };
}
