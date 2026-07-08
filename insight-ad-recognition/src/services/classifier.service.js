/**
 * Deterministic decision layer — audio-only version.
 *
 * Consumes the assembled profile JSON (built from CLAP + local audio metrics only) and produces
 * the final verdict:
 *   { detection: "ad" | "program" | "silence", score, confidence, scores, reasons }
 *
 * The primary signal is the CLAP category of the LAST chunk in the window (live edge = "what's
 * on right now"). The window-average CLAP scores are used as a secondary signal so a single
 * misclassified chunk doesn't flip a stable window. Silence (heavy silence_ratio + very low RMS)
 * is emitted as its own class, replacing the previous frame-based "black" detection.
 */

import { config } from "../config.js";

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function round(x) {
  return Math.round(x * 100) / 100;
}

/** Set of category names (from `config.adCategories`) that flip the verdict to "ad". */
const AD_CATEGORY_SET = new Set(config.adCategories.map(String));

function isAdCategory(name) {
  return typeof name === "string" && AD_CATEGORY_SET.has(name);
}

/**
 * @param {object} p assembled profile (audio-only shape defined in profile.service.js)
 * @returns {{
 *   detection: "ad" | "program" | "silence",
 *   score: number,
 *   confidence: number,
 *   scores: { ad: number, program: number, silence: number },
 *   reasons: string[]
 * }}
 */
export function classify(p) {
  const reasons = [];

  const lastChunk = p.audio_clap_last || null;
  const avg = p.audio_clap_score_avg ?? 0;
  const avgCat = p.audio_clap_category_avg || "unknown";
  const perCat = p.audio_clap_per_category || {};

  // ---- Silence / dead-air evidence ------------------------------------------
  // The old pipeline emitted "black" when the video went to black between segments. In the
  // audio-only pipeline we detect the equivalent by looking at silence_ratio + a very low RMS —
  // both derived purely from ffmpeg's astats/silencedetect on the extracted WAV.
  let silenceScore = 0;
  const silenceRatio = p.silence_ratio ?? 0;
  const audioRms = p.audio_rms ?? 0;
  if (silenceRatio >= config.thresholds.silenceRatio && audioRms < 0.05) {
    silenceScore = clamp01(0.6 + 0.4 * silenceRatio);
    reasons.push(`silence:ratio=${silenceRatio.toFixed(2)}`);
  } else if (silenceRatio >= 0.7 && audioRms < 0.1) {
    silenceScore = 0.35;
    reasons.push(`silence:soft`);
  }

  // ---- Advertisement evidence -----------------------------------------------
  // The last chunk (live edge) is the strongest signal for "what's playing right now". We give
  // it most of the weight so the moment CLAP flips to Advertisement / Television commercial we
  // can react without waiting for the whole window to average out.
  let adScore = 0;

  if (lastChunk && isAdCategory(lastChunk.category)) {
    adScore += 0.7 * (lastChunk.score ?? 0);
    reasons.push(`clap:last=${lastChunk.category}@${(lastChunk.score ?? 0).toFixed(2)}`);
  }

  // Window average as a stability signal: if the dominant category across the whole window is
  // an ad, that reinforces the verdict even when the last chunk is a borderline non-ad.
  if (isAdCategory(avgCat)) {
    adScore += 0.3 * avg;
    reasons.push(`clap:avg=${avgCat}@${avg.toFixed(2)}`);
  } else {
    // Sum of per-category probabilities for all ad-like classes (average). Captures cases where
    // the dominant category is non-ad but a large chunk of probability mass sits in ad classes.
    let adMass = 0;
    for (const cat of AD_CATEGORY_SET) {
      const v = perCat[cat];
      if (typeof v === "number" && Number.isFinite(v)) adMass += v;
    }
    if (adMass > 0.35) {
      adScore += 0.2 * clamp01(adMass);
      reasons.push(`clap:adMass=${adMass.toFixed(2)}`);
    }
  }

  adScore = clamp01(adScore);

  // ---- Program evidence -----------------------------------------------------
  let programScore = 0;

  if (lastChunk && !isAdCategory(lastChunk.category)) {
    programScore += 0.7 * (lastChunk.score ?? 0);
    reasons.push(`clap:last=${lastChunk.category}@${(lastChunk.score ?? 0).toFixed(2)}`);
  }
  if (!isAdCategory(avgCat)) {
    programScore += 0.3 * avg;
    reasons.push(`clap:avg=${avgCat}@${avg.toFixed(2)}`);
  }

  programScore = clamp01(programScore);

  // ---- Decision -------------------------------------------------------------
  const scores = {
    ad: round(adScore),
    program: round(programScore),
    silence: round(silenceScore),
  };

  let detection = "program";
  // Silence trumps everything when the window is genuinely dead air.
  if (silenceScore >= 0.6 && silenceScore >= adScore && silenceScore >= programScore) {
    detection = "silence";
  } else if (
    adScore >= programScore &&
    adScore >= silenceScore &&
    adScore >= config.thresholds.adMinScore
  ) {
    detection = "ad";
  } else if (silenceScore > adScore && silenceScore > programScore) {
    detection = "silence";
  } else {
    detection = "program";
  }

  const winning = scores[detection];
  const others = Object.entries(scores)
    .filter(([k]) => k !== detection)
    .map(([, v]) => v);
  const runnerUp = others.length ? Math.max(...others) : 0;
  const margin = clamp01(winning - runnerUp);
  const confidence = round(clamp01(0.5 * winning + 0.5 * (0.4 + margin)));

  return { detection, score: round(winning), confidence, scores, reasons };
}

export default { classify };
