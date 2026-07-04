/**
 * Deterministic decision layer.
 *
 * Consumes the assembled profile JSON and produces the final verdict:
 *   { detection: "ad" | "program" | "black", score, confidence }
 *
 * The scoring is fully transparent (weighted evidence, no learned model) so its behavior is
 * predictable and tunable. Each contributing signal is bounded and combined into three class
 * scores; the winner and its normalized margin drive `score`/`confidence`.
 */

/** Vision categories that strongly indicate a commercial / non-program filler. */
const AD_CATEGORIES = new Set(["TV commercial", "Slate", "Test pattern", "Logo bumper", "Credits"]);
const BLACK_CATEGORIES = new Set(["Black screen"]);
const PROGRAM_CATEGORIES = new Set([
  "Television program",
  "Movie",
  "News broadcast",
  "Sports broadcast",
  "Talk show",
  "Studio",
  "Animation",
]);

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * @param {object} p assembled profile
 * @returns {{ detection: string, score: number, confidence: number, scores: object, reasons: string[] }}
 */
export function classify(p) {
  const reasons = [];

  // ---- Black screen evidence -------------------------------------------------
  let blackScore = 0;
  blackScore += 0.7 * (p.blackscreen_ratio ?? 0);
  if (BLACK_CATEGORIES.has(p.video_category_avg)) {
    blackScore += 0.4 * (p.video_category_score_avg ?? 0.5);
    reasons.push("vision:black");
  }
  // Very low energy + high silence reinforces a static black/slate frame.
  if ((p.energy_avg ?? 0) < 0.05 && (p.silence_ratio ?? 0) > 0.7) {
    blackScore += 0.25;
    reasons.push("static+silent");
  }
  blackScore = clamp01(blackScore);

  // ---- Advertisement evidence ------------------------------------------------
  let adScore = 0;

  if (AD_CATEGORIES.has(p.video_category_avg)) {
    adScore += 0.35 * (p.video_category_score_avg ?? 0.5);
    reasons.push(`vision:${p.video_category_avg}`);
  }

  if (p.audio_category === "TV Commercial" || p.audio_category === "commercial") {
    adScore += 0.3 * (p.audio_category_score ?? 0.5);
    reasons.push("audio:commercial");
  }

  // OCR advertising cues.
  const ocrAdHits = [p.ocr_brand, p.ocr_price, p.ocr_cta, p.ocr_legal].filter(Boolean).length;
  if (ocrAdHits > 0) {
    adScore += Math.min(0.3, ocrAdHits * 0.1);
    reasons.push(`ocr:ad_cues=${ocrAdHits}`);
  }

  // Commercials are typically fast-cut and busy.
  adScore += 0.1 * clamp01((p.scene_change_rate ?? 0) * 0.7 + (p.motion_avg ?? 0) * 0.3);

  // Channel logo often removed during ad breaks (weak signal).
  if (p.channel_logo_present === false) adScore += 0.05;

  // Music-bed heavy with little speech leans commercial.
  if ((p.music_probability ?? 0) > 0.6 && (p.speech_ratio ?? 0) < 0.3) {
    adScore += 0.08;
    reasons.push("audio:musicbed");
  }
  adScore = clamp01(adScore);

  // ---- Program evidence ------------------------------------------------------
  let programScore = 0;
  if (PROGRAM_CATEGORIES.has(p.video_category_avg)) {
    programScore += 0.45 * (p.video_category_score_avg ?? 0.5);
    reasons.push(`vision:${p.video_category_avg}`);
  }
  if (p.channel_logo_present === true) programScore += 0.15;
  if (p.ticker_present) programScore += 0.1;
  if (p.lower_third_present) programScore += 0.05;
  if (p.ocr_news || p.ocr_sports) programScore += 0.1;
  if ((p.speech_ratio ?? 0) > 0.4) programScore += 0.1;
  if (p.audio_category === "program" || p.audio_category === "Program") {
    programScore += 0.2 * (p.audio_category_score ?? 0.5);
  }
  programScore = clamp01(programScore);

  // ---- Decision --------------------------------------------------------------
  const scores = {
    ad: round(adScore),
    program: round(programScore),
    black: round(blackScore),
  };

  // Black wins outright when the frame really is black-dominant.
  let detection = "program";
  if ((p.blackscreen_ratio ?? 0) >= 0.6 && blackScore >= adScore && blackScore >= programScore) {
    detection = "black";
  } else if (adScore >= programScore && adScore >= blackScore) {
    detection = "ad";
  } else if (blackScore >= programScore && blackScore > adScore) {
    detection = "black";
  } else {
    detection = "program";
  }

  const winning = scores[detection];
  const others = Object.entries(scores)
    .filter(([k]) => k !== detection)
    .map(([, v]) => v);
  const runnerUp = others.length ? Math.max(...others) : 0;

  // Confidence blends absolute winning score with its margin over the runner-up.
  const margin = clamp01(winning - runnerUp);
  const confidence = round(clamp01(0.5 * winning + 0.5 * (0.4 + margin)));

  return { detection, score: round(winning), confidence, scores, reasons };
}

function round(x) {
  return Math.round(x * 100) / 100;
}

export default { classify };
