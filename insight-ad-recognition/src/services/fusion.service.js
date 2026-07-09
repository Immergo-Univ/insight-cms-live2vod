/**
 * Multimodal fusion + deterministic decision layer.
 *
 * Consumes the assembled profile JSON (visual SigLIP + OCR cues + overlays + BERT semantic labels
 * + CLAP audio + local video/audio metrics) and produces the final verdict:
 *   { detection: "ad" | "program" | "silence", score, confidence, scores, reasons }
 *
 * Scoring is fully transparent (weighted evidence, no learned meta-model) so behavior is
 * predictable and tunable via `config.fusion`. Temporal consistency is handled two ways:
 *   - Heavy signals are already averaged across the sampled frames of the 10s window (SigLIP avg,
 *     overlay frame-ratio, OCR text joined over frames, CLAP window avg) — i.e. the window itself
 *     is the smoothing.
 *   - The final "ad" verdict additionally requires a SUSTAINED signal (overlay across frames, or a
 *     strong visual/audio average, or a hard OCR cue), so a single noisy frame can't flip it.
 */

import { config } from "../config.js";

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function round(x) {
  return Math.round(x * 100) / 100;
}

/** Visual SigLIP categories that count as ad-like vs program-like. */
const VISUAL_AD = new Set(["publicidad", "placa", "institucional"]);
const VISUAL_PROGRAM = new Set(["programa", "noticia", "deporte"]);

function isAudioAdCategory(name) {
  return typeof name === "string" && config.adCategories.includes(name);
}

/**
 * @param {object} p assembled profile (multimodal shape from profile.service.js)
 * @returns {{ detection: string, score: number, confidence: number, scores: object, reasons: string[] }}
 */
export function classify(p) {
  const w = config.fusion;
  const reasons = [];

  const visualCat = p.video_category_avg || "unknown";
  const visualScore = numOr(p.video_category_score_avg, 0);
  const overlayScore = numOr(p.overlay_score, 0);
  const overlayRatio = numOr(p.overlay_frame_ratio, 0);
  const bert = p.text_labels || {};
  const clapLast = p.audio_clap_last || null;
  const clapAvg = numOr(p.audio_clap_score_avg, 0);
  const clapAvgCat = p.audio_clap_category_avg || "unknown";

  // ---- Silence / dead-air --------------------------------------------------
  let silenceScore = 0;
  const silenceRatio = numOr(p.silence_ratio, 0);
  const audioRms = numOr(p.audio_rms, 0);
  const blackscreen = numOr(p.blackscreen_ratio, 0);
  if ((silenceRatio >= config.thresholds.silenceRatio && audioRms < 0.05) || blackscreen >= 0.8) {
    silenceScore = clamp01(0.5 + 0.3 * silenceRatio + 0.2 * blackscreen);
    reasons.push(`silence:ratio=${silenceRatio.toFixed(2)},black=${blackscreen.toFixed(2)}`);
  }

  // ---- Advertisement evidence ----------------------------------------------
  let adScore = 0;

  // Visual (SigLIP): publicidad / placa / institucional.
  if (VISUAL_AD.has(visualCat)) {
    adScore += w.visualAd * visualScore;
    reasons.push(`visual:${visualCat}@${visualScore.toFixed(2)}`);
  }

  // Overlay (banners / lower-thirds / logo-badges). NOTE: overlays appear in almost ALL broadcast
  // content (news tickers, sports lower-thirds, channel logos), so this is only a MINOR
  // reinforcement — never enough on its own to call an ad (see the sustained gate below).
  if (p.overlay_present) {
    adScore += w.overlay * Math.max(overlayScore, overlayRatio);
    reasons.push(`overlay@${overlayScore.toFixed(2)}x${overlayRatio.toFixed(2)}`);
  }

  // OCR strong cues: short-code / phone / price / % / URL / installments. These rarely appear
  // outside ads, so they carry real weight.
  const strong = numOr(p.strong_cue_count, 0);
  if (strong > 0) {
    adScore += Math.min(w.ocrStrongCap, strong * w.ocrStrongPer);
    reasons.push(`ocr:strong=${strong}`);
  }
  // A visible short-code (e.g. *2065) or phone is a hallmark of direct-response ads.
  if (p.ocr_short_code || p.ocr_phone) {
    adScore += w.ocrContactBonus;
    reasons.push(p.ocr_short_code ? "ocr:short_code" : "ocr:phone");
  }
  // OCR weak cues (CTA wording / legal fine print): noisy — small, capped contribution only.
  const weak = numOr(p.weak_cue_count, 0);
  if (weak > 0) {
    adScore += Math.min(w.ocrWeakCap, weak * w.ocrWeak);
    reasons.push(`ocr:weak=${weak}`);
  }

  // BERT semantic combo: contact + CTA + (brand OR price) is the classic ad triad.
  const contact = numOr(bert.contact, 0);
  const cta = numOr(bert.cta, 0);
  const brand = numOr(bert.brand, 0);
  const price = numOr(bert.price, 0);
  const th = w.bertLabelThreshold;
  const triad = [contact >= th, cta >= th, brand >= th || price >= th].filter(Boolean).length;
  if (triad >= 3) {
    adScore += w.bertTriad;
    reasons.push("bert:contact+cta+brand/price");
  } else if (triad === 2) {
    adScore += w.bertPair;
    reasons.push("bert:pair");
  }

  // Audio (CLAP): commercial-like categories in the last chunk (live edge) + window avg.
  if (clapLast && isAudioAdCategory(clapLast.category)) {
    adScore += w.audioAdLast * numOr(clapLast.score, 0);
    reasons.push(`clap:last=${clapLast.category}@${numOr(clapLast.score, 0).toFixed(2)}`);
  }
  if (isAudioAdCategory(clapAvgCat)) {
    adScore += w.audioAdAvg * clapAvg;
    reasons.push(`clap:avg=${clapAvgCat}@${clapAvg.toFixed(2)}`);
  }
  // Music-bed heavy with little speech (jingle-like).
  if (numOr(p.music_probability, 0) > 0.6 && numOr(p.speech_ratio, 0) < 0.3) {
    adScore += w.musicBed;
    reasons.push("audio:musicbed");
  }
  // Commercials are typically fast-cut / busy.
  adScore += w.fastCut * clamp01(numOr(p.scene_change_rate, 0) * 0.7 + numOr(p.motion_avg, 0) * 0.3);

  adScore = clamp01(adScore);

  // ---- Program evidence ----------------------------------------------------
  let programScore = 0;
  if (VISUAL_PROGRAM.has(visualCat)) {
    programScore += w.visualProgram * visualScore;
    reasons.push(`visual:${visualCat}@${visualScore.toFixed(2)}`);
  }
  if (numOr(p.speech_ratio, 0) > 0.4) programScore += w.programSpeech;
  if (!isAudioAdCategory(clapAvgCat) && clapAvgCat !== "unknown") {
    programScore += w.audioProgramAvg * clapAvg;
  }
  // A dominant program-intent from the BERT text also supports program.
  if (numOr(bert.program, 0) >= 0.6) programScore += w.bertProgram;
  programScore = clamp01(programScore);

  // ---- Discriminative-signal gate for "ad" ---------------------------------
  // The ad verdict REQUIRES at least one signal that actually distinguishes ads from regular
  // programming. Overlays and generic CTA wording are NOT enough (news/sports have overlays too,
  // and "now/ahora/עכשיו" show up everywhere). The discriminative signals are:
  //   - SigLIP says publicidad/placa/institucional with real confidence, OR
  //   - CLAP says a commercial-like category with real confidence, OR
  //   - a HARD OCR cue (short-code / phone / price / % / URL / installments).
  const hardOcrCue = Boolean(
    p.ocr_short_code ||
      p.ocr_phone ||
      p.ocr_price ||
      p.ocr_percent ||
      p.ocr_url ||
      p.ocr_installments,
  );
  const sustained =
    (VISUAL_AD.has(visualCat) && visualScore >= w.sustainedVisualScore) ||
    (isAudioAdCategory(clapAvgCat) && clapAvg >= w.sustainedAudioScore) ||
    (clapLast && isAudioAdCategory(clapLast.category) && numOr(clapLast.score, 0) >= w.sustainedAudioScore) ||
    hardOcrCue;

  // ---- Decision ------------------------------------------------------------
  const scores = { ad: round(adScore), program: round(programScore), silence: round(silenceScore) };

  let detection = "program";
  if (silenceScore >= 0.6 && silenceScore >= adScore && silenceScore >= programScore) {
    detection = "silence";
  } else if (
    adScore >= programScore &&
    adScore >= silenceScore &&
    adScore >= config.thresholds.adMinScore &&
    sustained
  ) {
    detection = "ad";
  } else if (silenceScore > adScore && silenceScore > programScore) {
    detection = "silence";
  } else {
    detection = "program";
  }

  if (detection === "ad" && !sustained) reasons.push("ad-gated:not-sustained");

  const winning = scores[detection];
  const others = Object.entries(scores)
    .filter(([k]) => k !== detection)
    .map(([, v]) => v);
  const runnerUp = others.length ? Math.max(...others) : 0;
  const margin = clamp01(winning - runnerUp);
  const confidence = round(clamp01(0.5 * winning + 0.5 * (0.4 + margin)));

  return { detection, score: round(winning), confidence, scores, reasons };
}

function numOr(v, def) {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}

export default { classify };
