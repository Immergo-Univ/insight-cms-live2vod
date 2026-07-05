/**
 * whisper.cpp integration. Transcribes the extracted 16 kHz mono WAV using a multilingual ggml
 * model with language auto-detection (Hebrew / Spanish / English / ...). Returns transcript text
 * plus a speech_ratio derived from the timestamped segments (spoken time / window time).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { run } from "../utils/exec.js";
import { logger } from "../utils/logger.js";

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function parseTranscriptFromJson(jsonStr) {
  try {
    const doc = JSON.parse(jsonStr);
    const segs = doc?.transcription || doc?.segments || [];
    const parts = [];
    for (const s of segs) {
      const txt = typeof s?.text === "string" ? s.text : "";
      if (txt) parts.push(txt.trim());
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function parseTimestampsToSpeechSec(jsonOrTxt) {
  // Prefer JSON with segment timestamps when available.
  try {
    const doc = JSON.parse(jsonOrTxt);
    const segs = doc?.transcription || doc?.segments || [];
    let spoken = 0;
    for (const s of segs) {
      const from = s?.offsets?.from ?? s?.from ?? null; // ms
      const to = s?.offsets?.to ?? s?.to ?? null;
      if (typeof from === "number" && typeof to === "number" && to > from) {
        spoken += (to - from) / 1000;
      }
    }
    return spoken;
  } catch {
    return null;
  }
}

/**
 * @param {string|null} audioPath
 * @param {string} workDir
 * @param {number} durationSec
 * @returns {Promise<{ transcript: string, speechRatio: number|null, ok: boolean }>}
 */
export async function transcribe(audioPath, workDir, durationSec) {
  if (!audioPath) return { transcript: "", speechRatio: 0, ok: false };

  const modelOk = await fileExists(config.tools.whisperModel);
  if (!modelOk) {
    logger.warn("whisper model missing; skipping transcription", { model: config.tools.whisperModel });
    return { transcript: "", speechRatio: null, ok: false };
  }

  const outBase = path.join(workDir, "whisper");
  const args = [
    "-m",
    config.tools.whisperModel,
    "-f",
    audioPath,
    "-l",
    // "auto" → whisper detects Hebrew/Spanish/English/... per window (requires a multilingual model).
    config.tools.whisperLanguage || "auto",
    "-t",
    String(config.tools.whisperThreads),
    "-nt", // no timestamps in the plain text output
    "-oj", // emit JSON (segments + timestamps): primary transcript + speech_ratio source
    "-otxt", // also write a .txt fallback
    "-of",
    outBase,
  ];

  let stdout = "";
  try {
    const res = await run(config.tools.whisperBin, args, { timeoutMs: config.limits.whisperTimeoutMs });
    stdout = res.stdout || "";
  } catch (e) {
    logger.warn("whisper.cpp invocation failed", { error: String(e?.message || e) });
    return { transcript: "", speechRatio: null, ok: false };
  }

  let transcript = "";
  let speechRatio = null;

  // Primary source: the JSON emitted by -oj (deterministic; stdout/-nt behavior varies by build).
  const jsonPath = `${outBase}.json`;
  if (await fileExists(jsonPath)) {
    const jsonRaw = await fs.readFile(jsonPath, "utf8");
    transcript = parseTranscriptFromJson(jsonRaw);
    const spoken = parseTimestampsToSpeechSec(jsonRaw);
    if (spoken != null && durationSec > 0) {
      speechRatio = Math.max(0, Math.min(1, spoken / durationSec));
    }
  }

  // Fallbacks: the .txt file, then stdout with any timestamp markers stripped.
  if (!transcript) {
    const txtPath = `${outBase}.txt`;
    if (await fileExists(txtPath)) {
      transcript = (await fs.readFile(txtPath, "utf8")).trim();
    }
  }
  if (!transcript) {
    transcript = stdout.replace(/\[[0-9:.\s\->]+\]/g, "").trim();
  }

  return { transcript, speechRatio, ok: true };
}

export default { transcribe };
