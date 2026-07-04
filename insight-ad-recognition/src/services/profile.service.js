/**
 * Orchestrates the full per-request pipeline and assembles the profile JSON described in
 * docs/insight-ad-recognition.md.
 *
 * Stages (video/audio/vision/text run concurrently where possible):
 *   1. Resolve input + extract window (frames + audio)         [media.service]
 *   2a. Local video metrics (energy/motion/blackscreen/...)    [frames.service]
 *   2b. Local audio metrics (rms/dynamic range/silence/...)    [audio.service]
 *   2c. whisper.cpp transcription (English)                    [whisper.service]
 *   2d. SigLIP zero-shot + OCR over frames                     [inference.client -> sidecar]
 *   3. Text commercial classification of the transcript        [inference.client -> sidecar]
 *   4. Merge into the profile JSON.
 *   5. Deterministic classification.                           [classifier.service]
 */

import { config } from "../config.js";
import { extractWindow } from "./media.service.js";
import { computeFrameMetrics } from "./frames.service.js";
import { computeAudioMetrics } from "./audio.service.js";
import { transcribe } from "./whisper.service.js";
import { inferVision, inferText } from "./inference.client.js";
import { classify } from "./classifier.service.js";
import { buildMosaic } from "./preview.service.js";
import { logger } from "../utils/logger.js";

function pickString(v, def) {
  return typeof v === "string" && v.length ? v : def;
}

/**
 * @param {string} videoUrl
 * @param {string} workDir
 */
export async function analyzeVideo(videoUrl, workDir) {
  const t0 = Date.now();

  const window = await extractWindow(videoUrl, workDir);
  const { framePaths, audioPath, durationSec, isLive, inputMeta } = window;

  // Build the mosaic preview from the captured frames (before the workDir is cleaned up).
  // One file per channel (sanitized video name), overwritten on each analysis.
  const previewFile = await buildMosaic(framePaths, videoUrl).catch(() => null);

  // Concurrent stage: local metrics + whisper + vision sidecar.
  const [frameMetrics, audioMetrics, whisperOut, vision] = await Promise.all([
    computeFrameMetrics(framePaths).catch((e) => {
      logger.warn("frame metrics failed", { error: String(e?.message || e) });
      return null;
    }),
    computeAudioMetrics(audioPath, durationSec).catch((e) => {
      logger.warn("audio metrics failed", { error: String(e?.message || e) });
      return null;
    }),
    transcribe(audioPath, workDir, durationSec).catch((e) => {
      logger.warn("whisper failed", { error: String(e?.message || e) });
      return { transcript: "", speechRatio: null, ok: false };
    }),
    inferVision(framePaths).catch(() => null),
  ]);

  // Text stage depends on the transcript.
  const textResult = await inferText(whisperOut?.transcript || "").catch(() => null);

  // ---- Assemble profile ------------------------------------------------------
  const fm = frameMetrics || {};
  const am = audioMetrics || {};
  const vis = vision || {};
  const ocr = vis.ocr || {};

  // Prefer whisper-derived speech ratio when available.
  const speechRatio =
    whisperOut?.speechRatio != null ? whisperOut.speechRatio : am.speech_ratio ?? 0;

  const profile = {
    duration: round1(durationSec),

    energy_avg: fm.energy_avg ?? 0,
    scene_change_rate: fm.scene_change_rate ?? 0,
    motion_avg: fm.motion_avg ?? 0,
    blackscreen_ratio: fm.blackscreen_ratio ?? 0,

    audio_category: pickString(textResult?.category, "unknown"),
    audio_category_score: numOr(textResult?.score, 0),
    audio_rms: am.audio_rms ?? 0,
    audio_dynamic_range: am.audio_dynamic_range ?? 0,
    speech_ratio: round2(speechRatio),
    music_probability: am.music_probability ?? 0,
    silence_ratio: am.silence_ratio ?? 0,

    video_category_avg: pickString(vis.video_category_avg, "unknown"),
    video_category_score_avg: numOr(vis.video_category_score_avg, 0),

    ocr_brand: Boolean(ocr.ocr_brand),
    ocr_price: Boolean(ocr.ocr_price),
    ocr_cta: Boolean(ocr.ocr_cta),
    ocr_legal: Boolean(ocr.ocr_legal),
    ocr_news: Boolean(ocr.ocr_news),
    ocr_sports: Boolean(ocr.ocr_sports),
    ocr_credits: Boolean(ocr.ocr_credits),

    ocr_text_density: numOr(ocr.ocr_text_density, 0),
    ocr_word_count: Math.round(numOr(ocr.ocr_word_count, 0)),

    channel_logo_present: vis.channel_logo_present ?? null,
    ticker_present: Boolean(vis.ticker_present),
    lower_third_present: Boolean(vis.lower_third_present),

    dominant_color_change: fm.dominant_color_change ?? 0,
  };

  const verdict = classify(profile);
  profile.confidence = verdict.confidence;

  const elapsedMs = Date.now() - t0;
  const transcript = whisperOut?.transcript || "";
  const ocrText = typeof ocr.ocr_text === "string" ? ocr.ocr_text : "";

  return {
    detection: verdict.detection,
    score: verdict.score,
    scores: verdict.scores,
    confidence: verdict.confidence,
    timestamp: Math.floor(Date.now() / 1000),
    transcript,
    ocr_text: ocrText,
    previewFile,
    profile,
    meta: {
      elapsedMs,
      isLive,
      frames: framePaths.length,
      hasAudio: Boolean(audioPath),
      transcript: whisperOut?.transcript || "",
      visionAvailable: Boolean(vision),
      textAvailable: Boolean(textResult),
      reasons: verdict.reasons,
      classScores: verdict.scores,
      input: inputMeta,
      categories: config.visionCategories,
    },
  };
}

function numOr(v, def) {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}
function round1(x) {
  return Math.round(x * 10) / 10;
}
function round2(x) {
  return Math.round((numOr(x, 0)) * 100) / 100;
}

export default { analyzeVideo };
