/**
 * OCR-text cue extraction (language-agnostic, deterministic).
 *
 * Scans the aggregated OCR text for the hallmarks of broadcast advertising that don't depend on a
 * language model: short-codes (e.g. `*2065` — a very strong ad signal on Israeli TV), phone
 * numbers, prices / percentages / installments, URLs, and promo/CTA keywords in Hebrew, Spanish and
 * English. The fusion layer turns these flags into ad evidence (strong cues weigh more than weak
 * brand-caps/legal wording, which are noisier).
 *
 * Kept as plain regex/keyword matching so it works on Hebrew text without any model.
 */

// Strong cues: rarely appear outside commercials / direct-response ads.
const SHORT_CODE_RE = /(?:^|[^\d])\*\d{3,5}(?![\d])/; // *2065, *1234
const PHONE_RE = /(?:0800|1[-\s]?800|\b0\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}\b|\b\d{3}[-\s]?\d{7}\b)/;
const PRICE_RE = /(?:[₪$€£]\s?\d|\d+[.,]\d{2}\s?(?:₪|\$|€|£|ils|nis|ars|usd)\b|\bILS\s?\d|\bNIS\s?\d)/i;
const PERCENT_RE = /\d{1,3}\s?%/;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s]+|\b[\w-]+\.(?:com|co\.il|net|org|tv|shop|store)\b/i;

// Installments / financing wording (es/en/he).
const INSTALLMENTS_RE =
  /\b(?:cuotas?|sin inter[eé]s|installments?|payments?)\b|תשלומים|בתשלומים|ללא ריבית/i;

// Promo / CTA keywords. Hebrew included for Channel 14 / i24 content.
//
// IMPORTANT: only ad-specific action phrases / promo wording. We deliberately EXCLUDE ubiquitous
// time adverbs like "ahora" / "now" / "עכשיו" — they appear constantly in news ("now at 7:30...")
// and "עכשיו 14" is literally a channel brand name, so they produced false CTA hits on newscasts.
const CTA_KEYWORDS = [
  // Spanish
  "promo",
  "oferta",
  "descuento",
  "gratis",
  "llama ya",
  "llamá ya",
  "comprá",
  "aprovecha",
  "ultimas unidades",
  "envío gratis",
  // English
  "sale",
  "discount",
  "call now",
  "buy now",
  "order now",
  "shop now",
  "limited offer",
  // Hebrew
  "מבצע", // sale/promo
  "חינם", // free
  "הזמינו", // order now
  "התקשרו", // call (imperative)
  "הנחה", // discount
];

// Weak cues: brand-like ALL-CAPS tokens and legal fine print (prone to OCR noise).
const LEGAL_RE =
  /\b(?:terms?|conditions?|t&c|disclaimer|see store|restrictions apply)\b|תקנון|בכפוף לתקנון|ט\.?ל\.?ח/i;

function countMatches(text, keywords) {
  const lower = text.toLowerCase();
  let n = 0;
  for (const kw of keywords) {
    // Hebrew keywords aren't affected by toLowerCase; match against both.
    if (lower.includes(kw.toLowerCase()) || text.includes(kw)) n += 1;
  }
  return n;
}

/**
 * @param {string} rawText aggregated OCR text over the window
 * @returns {{
 *   ocr_short_code: boolean,
 *   ocr_phone: boolean,
 *   ocr_price: boolean,
 *   ocr_percent: boolean,
 *   ocr_url: boolean,
 *   ocr_installments: boolean,
 *   ocr_cta: boolean,
 *   ocr_legal: boolean,
 *   strong_cue_count: number,
 *   weak_cue_count: number,
 *   ad_cue_count: number,
 *   cta_hits: number
 * }}
 */
export function extractOcrCues(rawText) {
  const text = typeof rawText === "string" ? rawText : "";

  const ocr_short_code = SHORT_CODE_RE.test(text);
  const ocr_phone = PHONE_RE.test(text);
  const ocr_price = PRICE_RE.test(text);
  const ocr_percent = PERCENT_RE.test(text);
  const ocr_url = URL_RE.test(text);
  const ocr_installments = INSTALLMENTS_RE.test(text);
  const cta_hits = countMatches(text, CTA_KEYWORDS);
  const ocr_cta = cta_hits > 0;
  const ocr_legal = LEGAL_RE.test(text);

  // Strong cues rarely appear outside ads (short-code / phone / price / % / URL / installments).
  // Weak cues (CTA wording, legal fine print) are noisier — they also show up in news/promos, so
  // they must NOT be enough on their own to declare an ad.
  const strong_cue_count = [
    ocr_short_code,
    ocr_phone,
    ocr_price,
    ocr_percent,
    ocr_url,
    ocr_installments,
  ].filter(Boolean).length;
  const weak_cue_count = [ocr_cta, ocr_legal].filter(Boolean).length;

  return {
    ocr_short_code,
    ocr_phone,
    ocr_price,
    ocr_percent,
    ocr_url,
    ocr_installments,
    ocr_cta,
    ocr_legal,
    strong_cue_count,
    weak_cue_count,
    ad_cue_count: strong_cue_count + weak_cue_count,
    cta_hits,
  };
}

export default { extractOcrCues };
