/**
 * Audio metrics derived from the extracted WAV via ffmpeg filters:
 *  - audio_rms / audio_dynamic_range  (from `astats`)
 *  - silence_ratio                     (from `silencedetect`)
 *  - speech_ratio                      (filled later from whisper segments; heuristic fallback here)
 *  - music_probability                 (heuristic combining RMS, dynamic range and silence)
 *
 * All values normalized to 0..1 where sensible.
 */

import { config } from "../config.js";
import { run } from "../utils/exec.js";

const DBFS_FLOOR = -60; // map [-60..0] dBFS → [0..1]

function dbToUnit(db) {
  if (!Number.isFinite(db)) return 0;
  const clamped = Math.max(DBFS_FLOOR, Math.min(0, db));
  return (clamped - DBFS_FLOOR) / -DBFS_FLOOR;
}

function parseAstats(stderr) {
  // ffmpeg astats prints "RMS level dB" and "Peak level dB" (overall block last).
  const rmsMatches = [...stderr.matchAll(/RMS level dB:\s*(-?\d+(?:\.\d+)?|-?inf)/gi)];
  const peakMatches = [...stderr.matchAll(/Peak level dB:\s*(-?\d+(?:\.\d+)?|-?inf)/gi)];

  const toNum = (m) => {
    if (!m) return NaN;
    const v = m[1];
    if (/inf/i.test(v)) return -Infinity;
    return parseFloat(v);
  };

  const rmsDb = toNum(rmsMatches.at(-1));
  const peakDb = toNum(peakMatches.at(-1));
  return { rmsDb, peakDb };
}

function parseSilence(stderr, totalSec) {
  const durations = [...stderr.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/gi)].map((m) =>
    parseFloat(m[1]),
  );
  const silentSec = durations.reduce((s, x) => s + x, 0);
  if (!Number.isFinite(totalSec) || totalSec <= 0) return 0;
  return Math.max(0, Math.min(1, silentSec / totalSec));
}

/**
 * @param {string|null} audioPath
 * @param {number} durationSec
 */
export async function computeAudioMetrics(audioPath, durationSec) {
  if (!audioPath) {
    return {
      audio_rms: 0,
      audio_dynamic_range: 0,
      silence_ratio: 1,
      speech_ratio: 0,
      music_probability: 0,
      has_audio: false,
    };
  }

  const res = await run(
    config.tools.ffmpeg,
    [
      "-nostdin",
      "-hide_banner",
      "-i",
      audioPath,
      "-af",
      `astats=metadata=1:reset=0,silencedetect=noise=${config.thresholds.silenceDb}dB:d=0.3`,
      "-f",
      "null",
      "-",
    ],
    { timeoutMs: 8000 },
  );

  const stderr = res.stderr || "";
  const { rmsDb, peakDb } = parseAstats(stderr);
  const silence_ratio = parseSilence(stderr, durationSec);

  const audio_rms = dbToUnit(rmsDb);
  // Dynamic range = distance between peak and RMS, normalized to a ~30 dB span.
  const drDb = Number.isFinite(peakDb) && Number.isFinite(rmsDb) ? peakDb - rmsDb : 0;
  const audio_dynamic_range = Math.max(0, Math.min(1, drDb / 30));

  // Heuristic speech proxy (refined later with whisper output).
  const speech_ratio = Math.max(0, Math.min(1, 1 - silence_ratio) * 0.6);

  // Music tends to have sustained energy (high RMS), low silence and moderate/low dynamic range.
  const music_probability = Math.max(
    0,
    Math.min(1, audio_rms * (1 - silence_ratio) * (1 - audio_dynamic_range * 0.5)),
  );

  return {
    audio_rms: round(audio_rms),
    audio_dynamic_range: round(audio_dynamic_range),
    silence_ratio: round(silence_ratio),
    speech_ratio: round(speech_ratio),
    music_probability: round(music_probability),
    has_audio: true,
  };
}

function round(x) {
  return Math.round(x * 100) / 100;
}

export default { computeAudioMetrics };
