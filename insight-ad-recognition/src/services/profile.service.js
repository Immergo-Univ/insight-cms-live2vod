/**
 * Orchestrates the full per-request multimodal pipeline and assembles the profile JSON.
 *
 * Over a short archive window (default 10s, VOD-style with startTime/endTime), extracts frames at
 * 1 fps + audio, then runs the CPU model battery and fuses everything into an ad/program/silence
 * verdict:
 *
 *   1. Resolve input + extract window (frames + 48 kHz WAV + 16 kHz WAV)          [media.service]
 *   2a. Local video metrics (blackscreen/motion/scene-change) + heavy-frame pick  [frames.service]
 *   2b. Local audio metrics (rms/dynamic range/silence/music)                     [audio.service]
 *   2c. whisper.cpp transcription (observability only)                            [whisper.service]
 *   2d. SigLIP + OCR + overlays over the heavy-sampled frames                     [inference.client -> /vision]
 *   2e. CLAP zero-shot over the audio, chunked                                    [inference.client -> /audio]
 *   3. OCR cue extraction (regex) + BERT semantic labels of the OCR text          [ocr.cues + /text]
 *   4. Merge into the profile JSON.
 *   5. Deterministic multimodal fusion -> verdict.                                [fusion.service]
 *
 * Temporal consistency lives inside the window: heavy signals are averaged across the sampled
 * frames and the fusion layer requires a sustained signal before declaring "ad".
 */

import { config } from "../config.js";
import { extractWindow } from "./media.service.js";
import { computeFrameMetrics, pickHeavyFrames } from "./frames.service.js";
import { computeAudioMetrics } from "./audio.service.js";
import { transcribe } from "./whisper.service.js";
import { inferVision, inferText, inferAudio } from "./inference.client.js";
import { extractOcrCues } from "./ocr.cues.js";
import { classify } from "./fusion.service.js";
import { buildMosaic } from "./preview.service.js";
import { logger } from "../utils/logger.js";

/**
 * @param {string} videoUrl
 * @param {string} workDir
 */
export async function analyzeVideo(videoUrl, workDir) {
  const t0 = Date.now();

  const window = await extractWindow(videoUrl, workDir);
  const { framePaths, audioClapPath, audioWhisperPath, durationSec, isLive, inputMeta } = window;

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

  // Concurrent stage: local audio metrics + whisper + vision (SigLIP/OCR/overlay) + CLAP.
  const [audioMetrics, whisperOut, vision, clap] = await Promise.all([
    computeAudioMetrics(audioWhisperPath, durationSec).catch((e) => {
      logger.warn("audio metrics failed", { error: String(e?.message || e) });
      return null;
    }),
    transcribe(audioWhisperPath, workDir, durationSec).catch((e) => {
      logger.warn("whisper failed", { error: String(e?.message || e) });
      return { transcript: "", speechRatio: null, ok: false };
    }),
    inferVision(heavyFrames).catch(() => null),
    inferAudio(audioClapPath, config.audio.chunkSeconds).catch(() => null),
  ]);

  // OCR cues (regex) + BERT semantic labels depend on the OCR text from /vision.
  const ocrText = typeof vision?.ocr_text === "string" ? vision.ocr_text : "";
  const cues = extractOcrCues(ocrText);
  const textResult = ocrText ? await inferText(ocrText).catch(() => null) : null;

  // ---- Assemble profile ------------------------------------------------------
  const am = audioMetrics || {};
  const vis = vision || {};
  const overlay = vis.overlay || {};
  const clapAvg = clap?.avg || {};
  const clapLast = clap?.last || null;
  const clapChunks = Array.isArray(clap?.chunks) ? clap.chunks : [];

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

    // ---- Audio (CLAP) -------------------------------------------------------
    audio_clap_category_avg: pickString(clapAvg.category, "unknown"),
    audio_clap_score_avg: numOr(clapAvg.score, 0),
    audio_clap_per_category:
      clapAvg.per_category && typeof clapAvg.per_category === "object" ? clapAvg.per_category : {},
    audio_clap_last: clapLast
      ? {
          startSec: numOr(clapLast.startSec, 0),
          endSec: numOr(clapLast.endSec, 0),
          category: pickString(clapLast.category, "unknown"),
          score: numOr(clapLast.score, 0),
        }
      : null,
    audio_clap_chunks: clapChunks.map((c) => ({
      startSec: numOr(c.startSec, 0),
      endSec: numOr(c.endSec, 0),
      category: pickString(c.category, "unknown"),
      score: numOr(c.score, 0),
    })),
    audio_clap_chunk_seconds: numOr(clap?.chunkSeconds, config.audio.chunkSeconds),
  };

  const verdict = classify(profile);
  profile.confidence = verdict.confidence;

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
    audio_category: profile.audio_clap_category_avg,
    ocr_ad_cue_count: profile.ocr_ad_cue_count,
    overlay_present: profile.overlay_present,
    previewFile,
    profile,
    meta: {
      elapsedMs,
      isLive,
      frames: framePaths.length,
      heavyFrames: heavyFrames.length,
      hasAudio: Boolean(audioClapPath),
      transcript,
      visionAvailable: Boolean(vision),
      textAvailable: Boolean(textResult),
      audioClapAvailable: Boolean(clap),
      chunks: clapChunks.length,
      chunkSeconds: profile.audio_clap_chunk_seconds,
      reasons: verdict.reasons,
      classScores: verdict.scores,
      input: inputMeta,
      visualCategories: Object.keys(config.visualCategories),
      audioCategories: config.audioCategories,
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
