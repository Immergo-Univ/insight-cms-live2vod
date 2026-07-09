/**
 * Orchestrates the full per-request multimodal pipeline and assembles the profile JSON.
 *
 * Over a short archive window (default 10s, VOD-style with startTime/endTime), extracts frames at
 * 1 fps + audio, then runs the CPU model battery and fuses everything into an ad/program/silence
 * verdict:
 *
 *   1. Resolve input + extract window (frames + 16 kHz WAV)                        [media.service]
 *   2a. Local video metrics (blackscreen/motion/scene-change) + heavy-frame pick  [frames.service]
 *   2b. Local audio metrics (rms/dynamic range/silence/music)                     [audio.service]
 *   2c. whisper.cpp transcription (observability only)                            [whisper.service]
 *   2d. SigLIP + OCR + overlays over the heavy-sampled frames                     [inference.client -> /vision]
 *   3. OCR cue extraction (regex) + BERT semantic labels of the OCR text          [ocr.cues + /text]
 *   4. Merge into the profile JSON.
 *   5. Deterministic multimodal fusion -> verdict.                                [fusion.service]
 *
 * Temporal consistency lives inside the window: heavy signals are averaged across the sampled
 * frames and the fusion layer requires a sustained signal before declaring "ad".
 *
 * (The CLAP audio classifier was removed — it misclassified ads/newscasts too often; audio now
 * contributes only via the local ffmpeg metrics: RMS / silence / music_probability / speech_ratio.)
 */

import { config } from "../config.js";
import { extractWindow } from "./media.service.js";
import { computeFrameMetrics, pickHeavyFrames } from "./frames.service.js";
import { computeAudioMetrics } from "./audio.service.js";
import { transcribe } from "./whisper.service.js";
import { inferVision, inferText } from "./inference.client.js";
import { detectLogoRoi, matchLogo } from "./logo.client.js";
import { extractOcrCues } from "./ocr.cues.js";
import { classify } from "./fusion.service.js";
import { buildMosaic } from "./preview.service.js";
import { logger } from "../utils/logger.js";

/**
 * @param {string} videoUrl
 * @param {string} workDir
 * @param {{ logo?: { collect?: boolean, roi?: object, templates?: string[] } | null }} [opts]
 */
export async function analyzeVideo(videoUrl, workDir, opts = {}) {
  const t0 = Date.now();
  const logoOpts = opts?.logo || null;

  const window = await extractWindow(videoUrl, workDir);
  const { framePaths, audioWhisperPath, durationSec, isLive, inputMeta } = window;
  const fps = config.segment.fps;

  // Mosaic preview from the captured frames (before the workDir is cleaned up).
  const previewFile = await buildMosaic(framePaths, videoUrl).catch(() => null);

  // Local video metrics + pick the heavy-frame subset (scene changes + boundaries).
  const frameOut = await computeFrameMetrics(framePaths).catch((e) => {
    logger.warn("frame metrics failed", { error: String(e?.message || e) });
    return null;
  });
  const fm = frameOut?.metrics || {};
  const heavyFrames = frameOut
    ? pickHeavyFrames(framePaths, frameOut.perFrameDiff, config.segment.heavyMaxFrames)
    : framePaths.slice(0, config.segment.heavyMaxFrames);

  // Logo MATCH runs over ALL frames (per-second transition resolution) and feeds the verdict, so
  // it goes in the concurrent stage. Only runs when the CMS supplied an ROI + templates.
  const wantMatch = Boolean(logoOpts?.roi && logoOpts?.templates?.length);

  // Concurrent stage: local audio metrics + whisper + vision (SigLIP/OCR/overlay) + logo match.
  const [audioMetrics, whisperOut, vision, logoMatch] = await Promise.all([
    computeAudioMetrics(audioWhisperPath, durationSec).catch((e) => {
      logger.warn("audio metrics failed", { error: String(e?.message || e) });
      return null;
    }),
    transcribe(audioWhisperPath, workDir, durationSec).catch((e) => {
      logger.warn("whisper failed", { error: String(e?.message || e) });
      return { transcript: "", speechRatio: null, ok: false };
    }),
    inferVision(heavyFrames).catch(() => null),
    wantMatch ? matchLogo(framePaths, logoOpts.roi, logoOpts.templates).catch(() => null) : Promise.resolve(null),
  ]);

  // OCR cues (regex) + BERT semantic labels depend on the OCR text from /vision.
  const ocrText = typeof vision?.ocr_text === "string" ? vision.ocr_text : "";
  const cues = extractOcrCues(ocrText);
  const textResult = ocrText ? await inferText(ocrText).catch(() => null) : null;

  // ---- Assemble profile ------------------------------------------------------
  const am = audioMetrics || {};
  const vis = vision || {};
  const overlay = vis.overlay || {};

  const speechRatio =
    whisperOut?.speechRatio != null ? whisperOut.speechRatio : am.speech_ratio ?? 0;

  const profile = {
    duration: round1(durationSec),

    // ---- Local video metrics -----------------------------------------------
    blackscreen_ratio: numOr(fm.blackscreen_ratio, 0),
    motion_avg: numOr(fm.motion_avg, 0),
    scene_change_rate: numOr(fm.scene_change_rate, 0),
    energy_avg: numOr(fm.energy_avg, 0),
    dominant_color_change: numOr(fm.dominant_color_change, 0),

    // ---- Local audio metrics ------------------------------------------------
    audio_rms: numOr(am.audio_rms, 0),
    audio_dynamic_range: numOr(am.audio_dynamic_range, 0),
    speech_ratio: round2(speechRatio),
    music_probability: numOr(am.music_probability, 0),
    silence_ratio: numOr(am.silence_ratio, 0),

    // ---- Visual (SigLIP) ----------------------------------------------------
    video_category_avg: pickString(vis.video_category_avg, "unknown"),
    video_category_score_avg: numOr(vis.video_category_score_avg, 0),
    video_per_category:
      vis.per_category && typeof vis.per_category === "object" ? vis.per_category : {},

    // ---- OCR text + cues ----------------------------------------------------
    ocr_text: ocrText,
    ocr_text_density: numOr(vis.ocr_text_density, 0),
    ocr_word_count: Math.round(numOr(vis.ocr_word_count, 0)),
    ocr_short_code: Boolean(cues.ocr_short_code),
    ocr_phone: Boolean(cues.ocr_phone),
    ocr_price: Boolean(cues.ocr_price),
    ocr_percent: Boolean(cues.ocr_percent),
    ocr_url: Boolean(cues.ocr_url),
    ocr_installments: Boolean(cues.ocr_installments),
    ocr_promo: Boolean(cues.ocr_promo),
    ocr_cta: Boolean(cues.ocr_cta),
    ocr_legal: Boolean(cues.ocr_legal),
    strong_cue_count: cues.strong_cue_count,
    weak_cue_count: cues.weak_cue_count,
    ocr_ad_cue_count: cues.ad_cue_count,

    // ---- Overlay detection (OpenCV) -----------------------------------------
    overlay_present: Boolean(overlay.overlay_present),
    lower_third_present: Boolean(overlay.lower_third_present),
    banner_present: Boolean(overlay.banner_present),
    logo_region_present: Boolean(overlay.logo_region_present),
    overlay_score: numOr(overlay.overlay_score, 0),
    overlay_frame_ratio: numOr(overlay.overlay_frame_ratio, 0),

    // ---- BERT semantic labels -----------------------------------------------
    text_category: pickString(textResult?.category, "unknown"),
    text_category_score: numOr(textResult?.score, 0),
    text_labels: textResult?.labels && typeof textResult.labels === "object" ? textResult.labels : {},

    // ---- Channel-logo matching (only when templates were provided) ----------
    logo_templates_used: logoMatch ? numOr(logoMatch.templates_used, 0) : 0,
    logo_present: logoMatch ? Boolean(logoMatch.present) : null,
    logo_present_ratio: logoMatch ? numOr(logoMatch.present_ratio, 0) : null,
  };

  const verdict = classify(profile);
  profile.confidence = verdict.confidence;

  // ---- Logo COLLECTION: only when the CMS still needs samples AND this window is confidently a
  // program (the logo is expected to be present during programming). Runs after the verdict.
  let logoOut = null;
  if (wantMatch && logoMatch) {
    const transitionIdx =
      typeof logoMatch.transition_index === "number" ? logoMatch.transition_index : null;
    logoOut = {
      mode: "match",
      roi: logoOpts.roi,
      present: Boolean(logoMatch.present),
      present_ratio: numOr(logoMatch.present_ratio, 0),
      score: numOr(logoMatch.score, 0),
      templates_used: numOr(logoMatch.templates_used, 0),
      per_frame: Array.isArray(logoMatch.per_frame) ? logoMatch.per_frame : [],
      // Program->ad boundary within the window: frame index + seconds from window start.
      transition_index: transitionIdx,
      transition_offset_sec: transitionIdx != null ? round2(transitionIdx / fps) : null,
    };
  } else if (logoOpts?.collect && verdict.detection === "program") {
    const det = await detectLogoRoi(framePaths).catch(() => null);
    if (det && det.roi) {
      logoOut = {
        mode: "collect",
        roi: det.roi,
        confidence: numOr(det.confidence, 0),
        sample_base64: typeof det.sample_base64 === "string" ? det.sample_base64 : null,
      };
    }
  }

  const elapsedMs = Date.now() - t0;
  const transcript = whisperOut?.transcript || "";

  return {
    detection: verdict.detection,
    score: verdict.score,
    scores: verdict.scores,
    confidence: verdict.confidence,
    timestamp: Math.floor(Date.now() / 1000),
    transcript,
    ocr_text: ocrText,
    // High-value queryable signals surfaced at the top level for the CMS to persist as columns.
    visual_category: profile.video_category_avg,
    ocr_ad_cue_count: profile.ocr_ad_cue_count,
    overlay_present: profile.overlay_present,
    // Channel-logo stage output (ROI + sample crop for collection, or presence + transition).
    logo: logoOut,
    previewFile,
    profile,
    meta: {
      elapsedMs,
      isLive,
      frames: framePaths.length,
      heavyFrames: heavyFrames.length,
      hasAudio: Boolean(audioWhisperPath),
      transcript,
      visionAvailable: Boolean(vision),
      textAvailable: Boolean(textResult),
      reasons: verdict.reasons,
      classScores: verdict.scores,
      input: inputMeta,
      visualCategories: Object.keys(config.visualCategories),
    },
  };
}

function pickString(v, def) {
  return typeof v === "string" && v.length ? v : def;
}
function numOr(v, def) {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}
function round1(x) {
  return Math.round(x * 10) / 10;
}
function round2(x) {
  return Math.round(numOr(x, 0) * 100) / 100;
}

export default { analyzeVideo };
