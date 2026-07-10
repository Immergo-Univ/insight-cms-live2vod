/**
 * Per-channel rule engine.
 *
 * Three configurable strategies, each yielding a 0..1 score; the final score is the average of the
 * ENABLED strategies and the verdict is `ad` when it reaches the channel threshold.
 *
 *  1. logoAppearance   — the configured logo/brand APPEARS in its ROI (pHash and/or OCR text match).
 *                        Multiple instances are OR-ed (any match => the strategy matches).
 *  2. logoDisappearance— the configured logo/brand is ABSENT from its ROI (inverse of appearance).
 *                        Multiple instances are OR-ed (any target gone => the strategy matches).
 *  3. ocrRules         — boolean expression over the full-screen OCR text: groups OR-ed, conditions
 *                        within a group AND-ed. Operators: includes / startsWith / endsWith /
 *                        similarTo / regex / between / majorTo / minorTo.
 *
 * Text comparisons pick the Original OCR text or its English (NLLB) translation per condition.
 */

// ---- config normalization ---------------------------------------------------------------------

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function pct(x, def) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  return Math.min(100, Math.max(1, n));
}

/**
 * Normalize a ROI to fractions (0..1). The admin UI stores ROIs in PIXELS relative to the channel
 * base resolution (baseW x baseH); we convert to fractions here so the sidecar crop is
 * resolution-independent. Legacy configs stored fractions directly (all values <= 1) — those are
 * detected and used as-is.
 */
function normRoi(roi, baseW, baseH) {
  const r = roi && typeof roi === "object" ? roi : {};
  let x = Number(r.x);
  let y = Number(r.y);
  let w = Number(r.w);
  let h = Number(r.h);
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;

  const looksNormalized =
    x <= 1 &&
    y <= 1 &&
    (!Number.isFinite(w) || w <= 1) &&
    (!Number.isFinite(h) || h <= 1);

  if (!looksNormalized && baseW > 0 && baseH > 0) {
    // Pixels relative to the base resolution -> fractions.
    x /= baseW;
    y /= baseH;
    w = Number.isFinite(w) ? w / baseW : 1;
    h = Number.isFinite(h) ? h / baseH : 1;
  } else if (!Number.isFinite(w) || w <= 0) {
    w = 1;
  }
  if (!Number.isFinite(h) || h <= 0) h = 1;

  x = clamp01(x);
  y = clamp01(y);
  w = clamp01(w);
  h = clamp01(h);
  if (w <= 0) w = 1;
  if (h <= 0) h = 1;
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x, y, w, h };
}

function normSample(s) {
  if (!s || typeof s !== "object") return null;
  const phash = typeof s.phash === "string" ? s.phash.trim().toLowerCase() : "";
  return {
    id: s.id != null ? String(s.id) : null,
    phash,
    ocrText: typeof s.ocrText === "string" ? s.ocrText : "",
    ocrTextEn: typeof s.ocrTextEn === "string" ? s.ocrTextEn : "",
  };
}

function normOcrOpt(o) {
  const src = o && typeof o === "object" ? o : {};
  return {
    enabled: Boolean(src.enabled),
    matchText: typeof src.matchText === "string" ? src.matchText : "",
    textSource: src.textSource === "translated" ? "translated" : "original",
    similarity: pct(src.similarity, 80),
  };
}

function normInstance(inst, idx, prefix, baseW, baseH) {
  const src = inst && typeof inst === "object" ? inst : {};
  const id = src.id != null ? String(src.id) : `${prefix}-${idx}`;
  return {
    id,
    roi: normRoi(src.roi, baseW, baseH),
    hashSensitivity: pct(src.hashSensitivity, 85),
    samples: Array.isArray(src.samples) ? src.samples.map(normSample).filter(Boolean) : [],
    ocr: normOcrOpt(src.ocr),
  };
}

function normLogoStrategy(strat, prefix, baseW, baseH) {
  const src = strat && typeof strat === "object" ? strat : {};
  const instances = Array.isArray(src.instances)
    ? src.instances.map((inst, i) => normInstance(inst, i, prefix, baseW, baseH))
    : [];
  return { enabled: Boolean(src.enabled) && instances.length > 0, instances };
}

const OPERATORS = new Set([
  "includes",
  "startsWith",
  "endsWith",
  "similarTo",
  "regex",
  "between",
  "majorTo",
  "minorTo",
]);

function normCondition(cond, idx) {
  const src = cond && typeof cond === "object" ? cond : {};
  const op = OPERATORS.has(src.op) ? src.op : "includes";
  return {
    id: src.id != null ? String(src.id) : `c-${idx}`,
    op,
    value: src.value != null ? String(src.value) : "",
    value2: src.value2 != null ? String(src.value2) : "",
    similarity: pct(src.similarity, 80),
    textSource: src.textSource === "translated" ? "translated" : "original",
  };
}

function normOcrRules(strat) {
  const src = strat && typeof strat === "object" ? strat : {};
  const groups = Array.isArray(src.groups)
    ? src.groups
        .map((g, gi) => ({
          id: g?.id != null ? String(g.id) : `g-${gi}`,
          conditions: Array.isArray(g?.conditions)
            ? g.conditions.map((c, ci) => normCondition(c, ci))
            : [],
        }))
        .filter((g) => g.conditions.length > 0)
    : [];
  return { enabled: Boolean(src.enabled) && groups.length > 0, groups };
}

/**
 * Normalize the raw per-channel config posted by the CMS into a safe, defaulted shape.
 */
export function normalizeConfig(raw, defaultThreshold) {
  const src = raw && typeof raw === "object" ? raw : {};
  let threshold = Number(src.threshold);
  if (!Number.isFinite(threshold)) threshold = defaultThreshold;
  threshold = Math.min(1, Math.max(0, threshold));

  // Base resolution the pixel ROIs were defined against (from the admin "Ad Recognition Setup").
  const baseWidth = Number.isFinite(Number(src.baseWidth)) ? Number(src.baseWidth) : 0;
  const baseHeight = Number.isFinite(Number(src.baseHeight)) ? Number(src.baseHeight) : 0;
  const fps = Number.isFinite(Number(src.fps)) ? Number(src.fps) : 0;

  return {
    threshold,
    baseWidth,
    baseHeight,
    fps,
    logoAppearance: normLogoStrategy(src.logoAppearance, "app", baseWidth, baseHeight),
    logoDisappearance: normLogoStrategy(src.logoDisappearance, "dis", baseWidth, baseHeight),
    ocrRules: normOcrRules(src.ocrRules),
  };
}

/**
 * Collect the ROI descriptors (one per logo instance) that the sidecar must crop/hash/OCR.
 */
export function collectRois(cfg) {
  const rois = [];
  const push = (strat) => {
    if (!strat.enabled) return;
    for (const inst of strat.instances) {
      rois.push({
        id: inst.id,
        x: inst.roi.x,
        y: inst.roi.y,
        w: inst.roi.w,
        h: inst.roi.h,
        ocr: inst.ocr.enabled,
        translate: inst.ocr.enabled && inst.ocr.textSource === "translated",
      });
    }
  };
  push(cfg.logoAppearance);
  push(cfg.logoDisappearance);
  return rois;
}

// ---- similarity helpers -----------------------------------------------------------------------

function normText(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized Levenshtein similarity in 0..1. */
function levRatio(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length;
  const n = b.length;
  const prev = new Array(n + 1);
  const cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  const dist = prev[n];
  return 1 - dist / Math.max(m, n);
}

/** Text-match similarity 0..1: substring containment wins, else fuzzy ratio. */
function textSimilarity(haystack, needle) {
  const h = normText(haystack);
  const q = normText(needle);
  if (!q) return 0;
  if (!h) return 0;
  if (h.includes(q)) return 1;
  return levRatio(h, q);
}

const HEX_BITS = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 1, 5: 2, 6: 2, 7: 3, 8: 1, 9: 2, a: 2, b: 3, c: 2, d: 3, e: 3, f: 4 };

/** Perceptual-hash similarity 0..1 (1 - normalized Hamming distance over equal-length hex hashes). */
function phashSimilarity(a, b) {
  const ha = String(a ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  const hb = String(b ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  const len = Math.min(ha.length, hb.length);
  if (len === 0) return 0;
  let dist = 0;
  for (let i = 0; i < len; i++) {
    const xor = parseInt(ha[i], 16) ^ parseInt(hb[i], 16);
    dist += HEX_BITS[xor.toString(16)] ?? 0;
  }
  const bits = len * 4;
  return 1 - dist / bits;
}

function pickText(sources, textSource) {
  return textSource === "translated" ? sources.textEn : sources.text;
}

function extractNumbers(text) {
  const out = [];
  const re = /-?\d+(?:[.,]\d+)?/g;
  let m;
  while ((m = re.exec(String(text ?? ""))) !== null) {
    const n = parseFloat(m[0].replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function buildRegex(value) {
  const raw = String(value ?? "");
  const m = raw.match(/^\/(.*)\/([a-z]*)$/is);
  try {
    if (m) return new RegExp(m[1], m[2] || "");
    return new RegExp(raw);
  } catch {
    return null;
  }
}

/** Evaluate a single OCR-rules condition against the chosen text source. */
function evalCondition(cond, fullText, fullTextEn) {
  const text = cond.textSource === "translated" ? fullTextEn : fullText;
  const value = cond.value;
  switch (cond.op) {
    case "includes":
      return normText(text).includes(normText(value));
    case "startsWith":
      return normText(text).startsWith(normText(value));
    case "endsWith":
      return normText(text).endsWith(normText(value));
    case "similarTo":
      return textSimilarity(text, value) * 100 >= cond.similarity;
    case "regex": {
      const re = buildRegex(value);
      return re ? re.test(String(text ?? "")) : false;
    }
    case "between": {
      const a = parseFloat(String(value).replace(",", "."));
      const b = parseFloat(String(cond.value2).replace(",", "."));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return extractNumbers(text).some((n) => n >= lo && n <= hi);
    }
    case "majorTo": {
      const a = parseFloat(String(value).replace(",", "."));
      return Number.isFinite(a) && extractNumbers(text).some((n) => n > a);
    }
    case "minorTo": {
      const a = parseFloat(String(value).replace(",", "."));
      return Number.isFinite(a) && extractNumbers(text).some((n) => n < a);
    }
    default:
      return false;
  }
}

// ---- per-strategy scoring ---------------------------------------------------------------------

/** Presence signal of a logo instance in its ROI: best pHash / OCR similarity + matched flag. */
function instancePresence(inst, roiResult) {
  const rr = roiResult || {};
  let phashSim = 0;
  for (const s of inst.samples) {
    if (!s.phash) continue;
    phashSim = Math.max(phashSim, phashSimilarity(rr.phash, s.phash));
  }
  const phashMatched = inst.samples.length > 0 && phashSim * 100 >= inst.hashSensitivity;

  let ocrSim = 0;
  let ocrMatched = false;
  if (inst.ocr.enabled && inst.ocr.matchText) {
    const roiText = inst.ocr.textSource === "translated" ? rr.ocrTextEn : rr.ocrText;
    ocrSim = textSimilarity(roiText, inst.ocr.matchText);
    ocrMatched = ocrSim * 100 >= inst.ocr.similarity;
  }

  return {
    id: inst.id,
    phashSim: round3(phashSim),
    ocrSim: round3(ocrSim),
    matched: phashMatched || ocrMatched,
    signal: Math.max(phashSim, ocrSim),
  };
}

function scoreAppearance(strat, roiResults) {
  const instances = strat.instances.map((inst) => instancePresence(inst, roiResults.get(inst.id)));
  const matched = instances.some((i) => i.matched);
  const bestSignal = instances.reduce((m, i) => Math.max(m, i.signal), 0);
  const score = matched ? 1 : round3(bestSignal);
  return { score, matched, instances };
}

function scoreDisappearance(strat, roiResults) {
  const instances = strat.instances.map((inst) => {
    const p = instancePresence(inst, roiResults.get(inst.id));
    return { ...p, present: p.matched, disappeared: !p.matched };
  });
  // OR semantics: if any configured target is gone, the strategy matches.
  const matched = instances.some((i) => i.disappeared);
  // When not matched (everything still present) the score reflects how close we are to absence.
  const maxPresence = instances.reduce((m, i) => Math.max(m, i.signal), 0);
  const score = matched ? 1 : round3(1 - maxPresence);
  return { score, matched, instances };
}

function scoreOcrRules(strat, fullText, fullTextEn) {
  const groups = strat.groups.map((g) => {
    const conditions = g.conditions.map((c) => ({
      id: c.id,
      op: c.op,
      value: c.value,
      textSource: c.textSource,
      matched: evalCondition(c, fullText, fullTextEn),
    }));
    return { id: g.id, matched: conditions.every((c) => c.matched), conditions };
  });
  const matched = groups.some((g) => g.matched);
  return { score: matched ? 1 : 0, matched, groups };
}

/**
 * Evaluate the whole config against the sidecar analysis of a single frame.
 *
 * @param {object} cfg normalized config (from normalizeConfig)
 * @param {{ fullOcr?: {text?:string, textEn?:string}, rois?: Array }} analysis sidecar /analyze result
 * @param {{ ffmpegMs?: number, sidecarMs?: number }} [timings]
 */
export function evaluate(cfg, analysis, timings = {}) {
  const roiResults = new Map();
  const rois = analysis?.rois;
  if (Array.isArray(rois)) {
    for (const r of rois) {
      if (r && r.id != null) roiResults.set(String(r.id), r);
    }
  }
  const fullText = analysis?.fullOcr?.text ?? "";
  const fullTextEn = analysis?.fullOcr?.textEn ?? "";

  const strategies = {};
  const contributions = [];

  if (cfg.logoAppearance.enabled) {
    const t = Date.now();
    const r = scoreAppearance(cfg.logoAppearance, roiResults);
    strategies.logoAppearance = { ...r, elapsedMs: Date.now() - t };
    contributions.push(r.score);
  }
  if (cfg.logoDisappearance.enabled) {
    const t = Date.now();
    const r = scoreDisappearance(cfg.logoDisappearance, roiResults);
    strategies.logoDisappearance = { ...r, elapsedMs: Date.now() - t };
    contributions.push(r.score);
  }
  if (cfg.ocrRules.enabled) {
    const t = Date.now();
    const r = scoreOcrRules(cfg.ocrRules, fullText, fullTextEn);
    strategies.ocrRules = { ...r, elapsedMs: Date.now() - t };
    contributions.push(r.score);
  }

  const enabledCount = contributions.length;
  const score = enabledCount ? round3(contributions.reduce((s, x) => s + x, 0) / enabledCount) : 0;
  const detection = enabledCount === 0 ? "program" : score >= cfg.threshold ? "ad" : "program";

  const scores = {};
  for (const [k, v] of Object.entries(strategies)) scores[k] = v.score;

  return {
    detection,
    score,
    threshold: cfg.threshold,
    scores,
    strategies,
    ocrText: fullText,
    ocrTextEn: fullTextEn,
    strategyResults: {
      enabledCount,
      ...strategies,
      timings: {
        ffmpegMs: timings.ffmpegMs ?? null,
        sidecarMs: timings.sidecarMs ?? null,
      },
    },
  };
}

function round3(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

export default { normalizeConfig, collectRois, evaluate };
