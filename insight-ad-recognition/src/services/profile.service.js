/**
 * Orchestrates the full per-request pipeline and assembles the audio-only profile JSON.
 *
 * Stages (audio metrics + whisper + CLAP run concurrently):
 *   1. Resolve input + extract window (frames for mosaic + 48 kHz WAV + 16 kHz WAV)  [media.service]
 *   2a. Local audio metrics (rms / dynamic range / silence / music)                   [audio.service]
 *   2b. whisper.cpp transcription (English + Hebrew + Spanish, observability only)    [whisper.service]
 *   2c. CLAP zero-shot audio classification, chunked at AUDIO_CHUNK_SECONDS           [inference.client]
 *   3. Merge into the profile JSON.
 *   4. Deterministic classification (last chunk drives the verdict).                  [classifier.service]
 *
 * NOTE: Frames are captured only to render the debug mosaic. The classifier no longer looks at
 * any pixel-derived signal (no SigLIP, no OCR, no motion / blackscreen — those were removed
 * with the switch to a pure audio-channel profile).
 */

import { config } from "../config.js";
import { extractWindow } from "./media.service.js";
import { computeAudioMetrics } from "./audio.service.js";
import { transcribe } from "./whisper.service.js";
import { inferAudio } from "./inference.client.js";
import { classify } from "./classifier.service.js";
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

  // Build the mosaic preview from the captured frames (before the workDir is cleaned up).
  // One file per channel (sanitized video name), overwritten on each analysis. This is the ONLY
  // consumer of the extracted frames — the classifier itself never touches pixel data.
  const previewFile = await buildMosaic(framePaths, videoUrl).catch(() => null);

  // Concurrent stage: local audio metrics + whisper + CLAP sidecar.
  const [audioMetrics, whisperOut, clap] = await Promise.all([
    computeAudioMetrics(audioWhisperPath, durationSec).catch((e) => {
      logger.warn("audio metrics failed", { error: String(e?.message || e) });
      return null;
    }),
    transcribe(audioWhisperPath, workDir, durationSec).catch((e) => {
      logger.warn("whisper failed", { error: String(e?.message || e) });
      return { transcript: "", speechRatio: null, ok: false };
    }),
    inferAudio(audioClapPath, config.audio.chunkSeconds).catch(() => null),
  ]);

  // ---- Assemble profile ------------------------------------------------------
  const am = audioMetrics || {};

  // Prefer whisper-derived speech ratio when available.
  const speechRatio =
    whisperOut?.speechRatio != null ? whisperOut.speechRatio : am.speech_ratio ?? 0;

  const clapAvg = clap?.avg || {};
  const clapLast = clap?.last || null;
  const clapChunks = Array.isArray(clap?.chunks) ? clap.chunks : [];

  const profile = {
    duration: round1(durationSec),

    // ---- Local audio metrics (ffmpeg astats + silencedetect) ----------------
    audio_rms: am.audio_rms ?? 0,
    audio_dynamic_range: am.audio_dynamic_range ?? 0,
    speech_ratio: round2(speechRatio),
    music_probability: am.music_probability ?? 0,
    silence_ratio: am.silence_ratio ?? 0,

    // ---- CLAP zero-shot audio classification (primary AD signal) ------------
    // Window-average category + score.
    audio_clap_category_avg: typeof clapAvg.category === "string" ? clapAvg.category : "unknown",
    audio_clap_score_avg: numOr(clapAvg.score, 0),
    // Per-category probabilities averaged across the whole window (full distribution).
    audio_clap_per_category:
      clapAvg && typeof clapAvg.per_category === "object" && clapAvg.per_category !== null
        ? clapAvg.per_category
        : {},
    // The LAST chunk in the window = the live edge. The classifier trusts this the most.
    audio_clap_last: clapLast
      ? {
          startSec: numOr(clapLast.startSec, 0),
          endSec: numOr(clapLast.endSec, 0),
          category: typeof clapLast.category === "string" ? clapLast.category : "unknown",
          score: numOr(clapLast.score, 0),
        }
      : null,
    // Per-chunk timeline. Consumers can find the exact chunk where a program → ad transition
    // occurred inside the window (5 s resolution by default → 4 chunks in a 20 s window).
    audio_clap_chunks: clapChunks.map((c) => ({
      startSec: numOr(c.startSec, 0),
      endSec: numOr(c.endSec, 0),
      category: typeof c.category === "string" ? c.category : "unknown",
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
    // Kept in the response shape for backwards compatibility with existing consumers, but always
    // empty now (OCR was removed).
    ocr_text: "",
    previewFile,
    profile,
    meta: {
      elapsedMs,
      isLive,
      frames: framePaths.length,
      hasAudio: Boolean(audioClapPath),
      transcript,
      audioClapAvailable: Boolean(clap),
      chunks: clapChunks.length,
      chunkSeconds: profile.audio_clap_chunk_seconds,
      reasons: verdict.reasons,
      classScores: verdict.scores,
      input: inputMeta,
      categories: config.audioCategories,
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
