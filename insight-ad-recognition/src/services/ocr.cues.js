/**
 * OCR-text cue extraction (language-agnostic, deterministic).
 *
 * Scans the aggregated OCR text for the hallmarks of broadcast advertising that don't depend on a
 * language model: short-codes (e.g. `*2065`), phone numbers, prices / percentages / installments,
 * URLs, strong retail-promo phrases (free shipping, 2x1, coupon, ...) and generic promo/CTA wording,
 * in Hebrew, Spanish and English. The fusion layer turns these flags into ad evidence:
 *   - STRONG cues (short-code / phone / price / % / URL / installments / promo) rarely appear
 *     outside ads and can, on their own, satisfy the "is this an ad?" gate;
 *   - WEAK cues (generic CTA verbs, legal fine print) are noisy and only add a small, capped bump.
 *
 * Kept as plain regex/keyword matching so it works on Hebrew text without any model.
 *
 * Matching note: Latin keywords are matched with Unicode word boundaries so short tokens like
 * "off"/"sale"/"deal" don't fire inside "office"/"wholesale"/"dealer". Hebrew keywords use plain
 * substring matching, because Hebrew attaches prefixes to words (e.g. "במבצע" = "in a sale" still
 * contains "מבצע").
 */

// ---- Regex cues (strong) ---------------------------------------------------------------------
const SHORT_CODE_RE = /(?:^|[^\d])\*\d{3,5}(?![\d])/; // *2065, *1234
// Phone numbers, including US-style toll-free written as "800-624-1484", "1-800-624-1484",
// "(800) 624-1484", "1.800.624.1484" (a 3-3-4 group with separators — separators are REQUIRED so
// we don't match bare 10-digit epochs like the startTime in the m3u8 URL). Also keeps Israeli
// 0-prefixed numbers and 0800.
const PHONE_RE =
  /\b1?[-.\s]?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b1[-.\s]?8(?:00|88|77|66|55|44|33)\b|0800|\b0\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}\b/;
const PRICE_RE =
  /(?:[₪$€£]\s?\d|\d+[.,]\d{2}\s?(?:₪|\$|€|£|ils|nis|ars|usd|eur|gbp)\b|\bILS\s?\d|\bNIS\s?\d|\bUSD\s?\d)/i;
const PERCENT_RE = /\d{1,3}\s?%/;
const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s]+|\b[\w-]+\.(?:com|co\.il|org\.il|net|org|tv|shop|store|online|app|io|es|ar|mx)\b/i;

// Installments / financing wording (es/en/he).
const INSTALLMENTS_RE =
  /\b(?:cuotas?|en\s*\d+\s*cuotas|sin inter[eé]s|installments?|payments?|financiaci[oó]n|financing)\b|תשלומים|בתשלומים|ללא ריבית|פריסת תשלומים/i;

// ---- Keyword sets ----------------------------------------------------------------------------

/**
 * STRONG retail-promo phrases. These are near-exclusive to advertising, so a single hit is
 * treated like a hard OCR cue (counts toward `strong_cue_count` and satisfies the ad gate).
 * Deliberately specific multi-word / high-signal terms — no generic single words here.
 */
const PROMO_KEYWORDS = [
  // Spanish
  "envío gratis",
  "envio gratis",
  "envío sin cargo",
  "sin cargo",
  "2x1",
  "3x2",
  "2 x 1",
  "cuotas sin interés",
  "cuotas sin interes",
  "hasta 12 cuotas",
  "50% off",
  "descuento exclusivo",
  "liquidación",
  "liquidacion",
  "oferta imperdible",
  "última oportunidad",
  "ultima oportunidad",
  "por tiempo limitado",
  "solo por hoy",
  "sólo por hoy",
  "stock limitado",
  "usá el código",
  "usa el código",
  "código de descuento",
  "cupón de descuento",
  "cupon de descuento",
  // English
  "free shipping",
  "free delivery",
  "buy one get one",
  "bogo",
  "% off",
  "percent off",
  "clearance sale",
  "clearance",
  "limited time offer",
  "limited time only",
  "while supplies last",
  "money back guarantee",
  "risk free",
  "promo code",
  "coupon code",
  "use code",
  "order today",
  "call today",
  "special financing",
  "no money down",
  "lowest price",
  "best price guaranteed",
  // Hebrew
  "משלוח חינם", // free shipping
  "משלוחים חינם",
  "1+1", // buy one get one (also appears as 1+1)
  "מבצע ענק", // huge sale
  "מבצע החודש", // sale of the month
  "לזמן מוגבל", // limited time
  "כמות מוגבלת", // limited quantity
  "רק היום", // only today
  "הזדמנות אחרונה", // last chance
  "אחריות מלאה", // full warranty
  "ללא עלות", // free of charge
  "קוד קופון", // coupon code
  "מבצע לחג", // holiday sale
];

/**
 * WEAK / generic promo + CTA wording. Common enough in promos AND occasionally in news, so these
 * only add a small capped bump and never satisfy the ad gate on their own.
 *
 * IMPORTANT: we still EXCLUDE ubiquitous time adverbs ("ahora"/"now"/"עכשיו") — they appear
 * constantly in news and "עכשיו 14" is a channel brand name.
 */
const CTA_KEYWORDS = [
  // Spanish
  "promo",
  "promoción",
  "promocion",
  "oferta",
  "ofertas",
  "descuento",
  "descuentos",
  "rebaja",
  "rebajas",
  "gratis",
  "regalo",
  "llamá ya",
  "llama ya",
  "llamá",
  "comprá",
  "compra ya",
  "compre ya",
  "pedí el tuyo",
  "pedi el tuyo",
  "reservá",
  "aprovecha",
  "aprovechá",
  "no te lo pierdas",
  "últimas unidades",
  "ultimas unidades",
  "suscribite",
  "suscríbete",
  "descargá la app",
  "ingresá a",
  "visitá",
  "consultá",
  "exclusivo",
  "garantía",
  // English
  "sale",
  "on sale",
  "discount",
  "save now",
  "save big",
  "free",
  "free trial",
  "buy now",
  "order now",
  "call now",
  "shop now",
  "act now",
  "hurry",
  "exclusive offer",
  "special offer",
  "best deal",
  "subscribe now",
  "sign up",
  "download the app",
  "learn more",
  "guaranteed",
  "toll free",
  // Hebrew
  "מבצע", // sale/promo
  "מבצעים",
  "הנחה", // discount
  "הנחות",
  "חינם", // free
  "בחינם",
  "הזמינו", // order
  "התקשרו", // call (imperative)
  "חייגו", // dial
  "רכשו", // buy (imperative)
  "קנו", // buy (imperative)
  "לרכישה", // to purchase
  "מוגבל", // limited
  "בלעדי", // exclusive
  "הטבה", // benefit/deal
  "הטבות",
  "חסכו", // save
  "מחיר מיוחד", // special price
  "אחריות", // warranty
];

// Weak cue: legal fine print (prone to OCR noise; only a soft ad hint).
const LEGAL_RE =
  /\b(?:terms?(?:\s*(?:&|and)\s*conditions?)?|conditions? apply|t&c|disclaimer|see store|restrictions apply|subject to)\b|תקנון|בכפוף לתקנון|ט\.?ל\.?ח/i;

// A token is "Hebrew" if it contains any Hebrew-block character.
const HEBREW_RE = /[\u0590-\u05FF]/;

/**
 * Count how many of `keywords` appear in `text`.
 *  - Hebrew keywords: substring match (Hebrew attaches prefixes to words).
 *  - Latin keywords: Unicode word-boundary match so short tokens don't fire inside longer words.
 */
function countMatches(text, keywords) {
  let n = 0;
  for (const kw of keywords) {
    if (HEBREW_RE.test(kw)) {
      if (text.includes(kw)) n += 1;
      continue;
    }
    // Latin: build a boundary-aware, case-insensitive matcher. Escape regex metachars, and treat
    // any run of whitespace in the keyword as flexible whitespace.
    const escaped = kw
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    // `(?<![\p{L}\p{N}])` / `(?![\p{L}\p{N}])` = not preceded/followed by a letter or digit, so
    // "off" won't match "office" but "% off" and "2x1" still match. Unicode-aware for accents.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) n += 1;
  }
  return n;
}

/**
 * @param {string} rawText aggregated OCR text over the window
 * @returns {{
 *   ocr_short_code: boolean, ocr_phone: boolean, ocr_price: boolean, ocr_percent: boolean,
 *   ocr_url: boolean, ocr_installments: boolean, ocr_promo: boolean, ocr_cta: boolean,
 *   ocr_legal: boolean, strong_cue_count: number, weak_cue_count: number, ad_cue_count: number,
 *   promo_hits: number, cta_hits: number
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
  const promo_hits = countMatches(text, PROMO_KEYWORDS);
  const ocr_promo = promo_hits > 0;
  const cta_hits = countMatches(text, CTA_KEYWORDS);
  const ocr_cta = cta_hits > 0;
  const ocr_legal = LEGAL_RE.test(text);

  // Strong cues rarely appear outside ads (short-code / phone / price / % / URL / installments /
  // retail-promo phrase). Weak cues (generic CTA wording, legal fine print) are noisier — they
  // also show up in news/promos, so they must NOT be enough on their own to declare an ad.
  const strong_cue_count = [
    ocr_short_code,
    ocr_phone,
    ocr_price,
    ocr_percent,
    ocr_url,
    ocr_installments,
    ocr_promo,
  ].filter(Boolean).length;
  const weak_cue_count = [ocr_cta, ocr_legal].filter(Boolean).length;

  return {
    ocr_short_code,
    ocr_phone,
    ocr_price,
    ocr_percent,
    ocr_url,
    ocr_installments,
    ocr_promo,
    ocr_cta,
    ocr_legal,
    strong_cue_count,
    weak_cue_count,
    ad_cue_count: strong_cue_count + weak_cue_count,
    promo_hits,
    cta_hits,
  };
}

export default { extractOcrCues };
