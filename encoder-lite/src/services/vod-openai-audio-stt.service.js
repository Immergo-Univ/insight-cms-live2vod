/**
 * Speech-to-text via OpenAI Audio API (hosted whisper / compatible models).
 * Extracts lightweight mono audio with ffmpeg (never sends m3u8 URLs to OpenAI),
 * chunks long files under a byte budget using silence-based cuts (ffmpeg silencedetect),
 * then merges transcripts. Used for realtime transcribe and VOD burned subtitles.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { spawnFailureMessage } from "../utils/spawn-failure-message.js";
import { config } from "../config.js";
import { ffmpegInputGlobalArgs } from "./vod-ffmpeg-encoder.service.js";
import {
  usesDiarizedSttModel,
  openaiTranscribeDiarizedOneFile,
  inferSpeakerLabelsFromSegmentSamples,
  formatTranscriptDashLines,
  diarizedSegmentsToSrt,
} from "./openai-stt-diarize.service.js";
import {
  buildOpenAiClipUsageReport,
  normalizeUsageFromResponseJson,
  usageStepRow,
} from "../utils/openai-usage.js";

/** OpenAI transcription file limit is 25MB; we stay under 10MB per request. */
const MAX_CHUNK_BYTES = 10 * 1024 * 1024;
const SAFE_CHUNK_BYTES = Math.floor(MAX_CHUNK_BYTES * 0.92);
const MIN_CHUNK_SEC = 8;
const SILENCE_DETECT_DB = -35;
const SILENCE_MIN_LEN_SEC = 0.35;
const SILENCE_SEARCH_SEC = 60;

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_TRANSLATIONS_URL = "https://api.openai.com/v1/audio/translations";

/** @type {Set<string>} */
const STT_LANGS = new Set([
  "auto",
  "ar",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fr",
  "he",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "ru",
  "sv",
  "tr",
  "uk",
  "vi",
  "zh",
  "fi",
  "ro",
]);

/**
 * @param {string[]} args
 * @param {() => boolean} shouldCancel
 */
function runFfmpeg(args, shouldCancel) {
  return new Promise((resolve, reject) => {
    if (shouldCancel()) {
      reject(new Error("CANCELLED"));
      return;
    }
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c) => {
      stdout += c.toString();
    });
    proc.stderr?.on("data", (c) => {
      stderr += c.toString();
    });
    const check = setInterval(() => {
      if (shouldCancel()) {
        clearInterval(check);
        proc.kill("SIGKILL");
      }
    }, 400);
    proc.on("error", (err) => {
      clearInterval(check);
      reject(err);
    });
    proc.on("close", (code, signal) => {
      clearInterval(check);
      if (shouldCancel()) {
        reject(new Error("CANCELLED"));
        return;
      }
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new Error(
            spawnFailureMessage({
              commandLabel: "ffmpeg",
              code: code ?? null,
              signal: signal ?? null,
              stderr: stderr + stdout,
            }),
          ),
        );
      }
    });
  });
}

/**
 * @param {unknown} s
 * @returns {string}
 */
function normalizeSourceLang(s) {
  const x = String(s ?? "auto").trim();
  return STT_LANGS.has(x) ? x : "auto";
}

/**
 * @param {unknown} o
 * @returns {string}
 */
function normalizeOutputLang(o) {
  const x = String(o ?? "same").trim();
  if (x === "same" || x === "auto") return "same";
  if (STT_LANGS.has(x) && x !== "auto") return x;
  return "same";
}

/**
 * @param {unknown} lm
 * @returns {{ source: string, output: string }}
 */
function legacyLanguageModeToPair(lm) {
  switch (String(lm || "").trim()) {
    case "translate_en_he":
      return { source: "he", output: "en" };
    case "translate_en":
      return { source: "auto", output: "en" };
    case "es":
      return { source: "es", output: "same" };
    case "he":
      return { source: "he", output: "same" };
    default:
      return { source: "auto", output: "same" };
  }
}

/**
 * @param {unknown} subtitles
 * @returns {{ source: string, output: string, translateToEnglish: boolean, openaiLanguage: string | null }}
 */
export function resolveOpenAiSttLanguages(subtitles) {
  if (!subtitles || typeof subtitles !== "object") {
    return { source: "auto", output: "same", translateToEnglish: false, openaiLanguage: null };
  }
  const s = /** @type {{ whisperSourceLanguage?: unknown, whisperOutputLanguage?: unknown, languageMode?: unknown }} */ (
    subtitles
  );
  const hasNew =
    s.whisperSourceLanguage != null &&
    s.whisperOutputLanguage != null &&
    String(s.whisperOutputLanguage).trim() !== "";
  let source = "auto";
  let output = "same";
  if (hasNew) {
    source = normalizeSourceLang(s.whisperSourceLanguage);
    output = normalizeOutputLang(s.whisperOutputLanguage);
  } else if (s.languageMode != null && String(s.languageMode).trim() !== "") {
    const p = legacyLanguageModeToPair(s.languageMode);
    source = p.source;
    output = p.output;
  }
  const translateToEnglish = output === "en" && source !== "en";
  /** @type {string | null} */
  let openaiLanguage = null;
  if (!translateToEnglish) {
    if (source !== "auto") openaiLanguage = source;
    else if (output !== "same" && output !== "auto") openaiLanguage = output;
  }
  return { source, output, translateToEnglish, openaiLanguage };
}

/**
 * @param {string} inputPathOrUrl
 * @param {number | null} startSec
 * @param {number | null} endSec
 * @param {string} outPath absolute path (.ogg)
 * @param {() => boolean} shouldCancel
 */
export async function extractLightweightMonoOpusOgg(opts) {
  const { inputPathOrUrl, startSec, endSec, outPath, shouldCancel } = opts;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...ffmpegInputGlobalArgs(inputPathOrUrl),
  ];
  if (startSec != null && Number.isFinite(startSec) && startSec > 0) {
    args.push("-ss", String(startSec));
  }
  args.push("-i", inputPathOrUrl);
  if (endSec != null && Number.isFinite(endSec)) {
    if (startSec != null && Number.isFinite(startSec)) {
      const dur = Math.max(0.08, endSec - startSec);
      args.push("-t", String(dur));
    } else {
      args.push("-to", String(endSec));
    }
  }
  args.push(
    "-vn",
    "-map",
    "0:a:0",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "libopus",
    "-b:a",
    "48k",
    "-application",
    "voip",
    outPath,
  );
  await runFfmpeg(args, shouldCancel);
}

/**
 * @param {string} inputPath
 * @param {number} startSec
 * @param {number} endSec
 * @param {string} outPath
 * @param {() => boolean} shouldCancel
 */
async function extractOpusSegmentFromFile(opts) {
  const { inputPath, startSec, endSec, outPath, shouldCancel } = opts;
  const dur = Math.max(MIN_CHUNK_SEC / 2, endSec - startSec);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(startSec),
    "-i",
    inputPath,
    "-t",
    String(dur),
    "-vn",
    "-map",
    "0:a:0",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "libopus",
    "-b:a",
    "48k",
    "-application",
    "voip",
    outPath,
  ];
  await runFfmpeg(args, shouldCancel);
}

/**
 * @param {string} inputPath
 * @returns {Promise<number>}
 */
async function ffprobeDurationSec(inputPath) {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (c) => {
      out += c.toString();
    });
    proc.stderr?.on("data", () => {});
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe duration failed code=${code}`));
        return;
      }
      const v = parseFloat(out.trim());
      if (!Number.isFinite(v) || v <= 0) {
        reject(new Error("ffprobe could not read duration"));
        return;
      }
      resolve(v);
    });
  });
}

/**
 * Parse ffmpeg silencedetect stderr into silence intervals [start, end].
 * @param {string} stderr
 * @returns {Array<{ start: number, end: number }>}
 */
export function parseSilenceIntervalsFromFfmpegStderr(stderr) {
  const lines = String(stderr || "").split(/\r?\n/);
  /** @type {Array<{ start: number, end: number }>} */
  const out = [];
  /** @type {number | null} */
  let pendingStart = null;
  for (const line of lines) {
    const ms = line.match(/silence_start:\s*([\d.]+)/);
    const me = line.match(/silence_end:\s*([\d.]+)/);
    if (ms) {
      const x = parseFloat(ms[1]);
      if (Number.isFinite(x)) pendingStart = x;
    }
    if (me && pendingStart != null) {
      const end = parseFloat(me[1]);
      if (Number.isFinite(end) && end > pendingStart + 0.05) {
        out.push({ start: pendingStart, end });
      }
      pendingStart = null;
    }
  }
  return out;
}

/**
 * @param {string} audioPath
 * @param {() => boolean} shouldCancel
 * @returns {Promise<Array<{ start: number, end: number }>>}
 */
async function detectSilenceIntervals(audioPath, shouldCancel) {
  const args = [
    "-hide_banner",
    "-i",
    audioPath,
    "-af",
    `silencedetect=noise=${SILENCE_DETECT_DB}dB:d=${SILENCE_MIN_LEN_SEC}`,
    "-f",
    "null",
    "-",
  ];
  const { stderr, stdout } = await runFfmpeg(args, shouldCancel);
  return parseSilenceIntervalsFromFfmpegStderr(stderr + stdout);
}

/**
 * Pick a cut time in [chunkStart, duration] near targetEnd, preferring mid-silence inside search window.
 * @param {number} chunkStart
 * @param {number} targetEnd
 * @param {number} duration
 * @param {Array<{ start: number, end: number }>} silences
 */
function pickCutAtSilence(chunkStart, targetEnd, duration, silences) {
  const hardMax = duration;
  const lo = Math.max(chunkStart + MIN_CHUNK_SEC, targetEnd - SILENCE_SEARCH_SEC);
  const hi = Math.min(hardMax, targetEnd + SILENCE_SEARCH_SEC);
  let best = Math.min(hardMax, targetEnd);
  let bestScore = Infinity;
  for (const s of silences) {
    const mid = (s.start + s.end) / 2;
    if (mid < lo || mid > hi || mid <= chunkStart + MIN_CHUNK_SEC * 0.5) continue;
    const score = Math.abs(mid - targetEnd);
    if (score < bestScore) {
      bestScore = score;
      best = mid;
    }
  }
  if (best <= chunkStart + MIN_CHUNK_SEC) {
    best = Math.min(hardMax, chunkStart + MIN_CHUNK_SEC);
  }
  return best;
}

/**
 * @param {number} durationSec
 * @param {number} fileSizeBytes
 * @param {Array<{ start: number, end: number }>} silences
 * @returns {Array<{ startSec: number, endSec: number }>}
 */
export function planOpusChunksBySizeAndSilence(durationSec, fileSizeBytes, silences) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Invalid audio duration for chunking");
  }
  const bps = fileSizeBytes / durationSec;
  const targetSpanSec = Math.max(MIN_CHUNK_SEC * 2, SAFE_CHUNK_BYTES / Math.max(800, bps));

  /** @type {Array<{ startSec: number, endSec: number }>} */
  const chunks = [];
  let start = 0;
  let guard = 0;
  while (start < durationSec - 1e-3 && guard++ < 500) {
    const idealEnd = Math.min(durationSec, start + targetSpanSec);
    let end = pickCutAtSilence(start, idealEnd, durationSec, silences);
    if (end <= start + MIN_CHUNK_SEC * 0.25) {
      end = Math.min(durationSec, start + MIN_CHUNK_SEC);
    }
    if (end > durationSec) end = durationSec;
    if (end <= start + 1e-3) {
      end = Math.min(durationSec, start + MIN_CHUNK_SEC);
    }
    if (end <= start + 1e-3) {
      end = Math.min(durationSec, start + 0.5);
    }
    chunks.push({ startSec: start, endSec: end });
    if (end >= durationSec - 1e-3) break;
    start = end;
  }
  if (chunks.length === 0) {
    chunks.push({ startSec: 0, endSec: durationSec });
  }
  return chunks;
}

/**
 * @param {string} srtTime `HH:MM:SS,mmm`
 * @returns {number} ms from 0
 */
function srtTimeToMs(srtTime) {
  const m = String(srtTime).trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return 0;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  let ms = parseInt(m[4].padEnd(3, "0"), 10);
  return (((h * 60 + min) * 60 + s) * 1000 + ms) | 0;
}

/**
 * @param {number} totalMs
 * @returns {string}
 */
function msToSrtTime(totalMs) {
  let ms = Math.max(0, Math.round(totalMs));
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const min = Math.floor(ms / 60000);
  ms -= min * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  const pad = (n, w) => String(n).padStart(w, "0");
  return `${pad(h, 2)}:${pad(min, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

/**
 * Shift all timestamps in SRT by offsetMs; renumber cues from firstIndex.
 * @param {string} srt
 * @param {number} offsetMs
 * @param {number} firstIndex
 */
function shiftSrtContent(srt, offsetMs, firstIndex) {
  const blocks = String(srt || "")
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean);
  /** @type {string[]} */
  const out = [];
  let idx = firstIndex;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1;
    const timeLine = lines[i];
    if (!timeLine || !timeLine.includes("-->")) continue;
    const tm = timeLine.split(/-->/).map((x) => x.trim());
    if (tm.length < 2) continue;
    const aMs = srtTimeToMs(tm[0]) + offsetMs;
    const bMs = srtTimeToMs(tm[1]) + offsetMs;
    if (bMs < aMs) continue;
    const textLines = lines.slice(i + 1).filter((l) => l.length > 0);
    out.push(`${idx}\n${msToSrtTime(aMs)} --> ${msToSrtTime(bMs)}\n${textLines.join("\n")}`);
    idx += 1;
  }
  return out.join("\n\n") + (out.length ? "\n" : "");
}

/**
 * @param {string} srtContent
 * @returns {string}
 */
export function parseSrtContentToPlainText(srtContent) {
  const lines = String(srtContent || "").split(/\r?\n/);
  const blocks = [];
  let mode = 0;
  /** @type {string[]} */
  let buf = [];
  for (const line of lines) {
    if (mode === 0) {
      if (/^\d+$/.test(line.trim())) mode = 1;
      continue;
    }
    if (mode === 1) {
      if (line.includes("-->")) mode = 2;
      continue;
    }
    if (mode === 2) {
      const t = line.trim();
      if (t === "") {
        if (buf.length) blocks.push(buf.join(" "));
        buf = [];
        mode = 0;
      } else {
        buf.push(t);
      }
    }
  }
  if (buf.length) blocks.push(buf.join(" "));
  return blocks.join("\n\n").trim();
}

/**
 * @param {object} opts
 * @param {string} opts.filePath
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {boolean} opts.translateToEnglish
 * @param {string | null} opts.language ISO-639-1 when not translating
 * @param {"json" | "srt"} opts.responseFormat
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ text: string, srt: string, usage: ReturnType<typeof normalizeUsageFromResponseJson> }>}
 */
async function openaiTranscribeOneFile(opts) {
  const { filePath, apiKey, model, translateToEnglish, language, responseFormat, signal } = opts;
  const url = translateToEnglish ? OPENAI_TRANSLATIONS_URL : OPENAI_TRANSCRIPTIONS_URL;
  const buf = await fs.readFile(filePath);
  const base = path.basename(filePath) || "audio.ogg";
  const form = new FormData();
  const blob = new Blob([buf], { type: "audio/ogg" });
  form.append("file", blob, base);
  form.append("model", model);
  form.append("response_format", responseFormat);
  if (!translateToEnglish && language && language.length === 2) {
    form.append("language", language);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI STT HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  if (responseFormat === "srt") {
    return { text: "", srt: raw.trim(), usage: null };
  }
  /** @type {{ text?: string }} */
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("OpenAI STT returned non-JSON for json format");
  }
  const t = typeof data?.text === "string" ? data.text.trim() : "";
  const usage = normalizeUsageFromResponseJson(data);
  return { text: t, srt: "", usage };
}

function requireOpenAiKey() {
  const k = config.openaiApiKey;
  if (!k) {
    throw new Error(
      "OPENAI_API_KEY is required for speech-to-text (encoder-lite). Set it in the encoder environment.",
    );
  }
  return k;
}

/**
 * Non-diarized / translation path: whisper-1 or gpt-4o-mini-transcribe style JSON chunks → plain text.
 *
 * @param {object} ctx
 * @param {string} ctx.audioPath
 * @param {string} ctx.workDir
 * @param {object} [ctx.subtitles]
 * @param {() => boolean} ctx.shouldCancel
 * @param {string} [ctx.sttModelOverride] non-translate STT model (e.g. gpt-4o-mini-transcribe when skipping diarize)
 * @returns {Promise<{ transcriptText: string, openaiClipUsage: Record<string, unknown> }>}
 */
async function transcribeNonDiarizedToPlainText(ctx) {
  const { audioPath, workDir, subtitles, shouldCancel } = ctx;
  const apiKey = config.openaiApiKey;
  const { translateToEnglish, openaiLanguage } = resolveOpenAiSttLanguages(subtitles);
  const override =
    typeof ctx.sttModelOverride === "string" && ctx.sttModelOverride.trim().length > 0
      ? ctx.sttModelOverride.trim()
      : "";
  const model = translateToEnglish
    ? (process.env.OPENAI_STT_TRANSLATE_MODEL || "whisper-1").trim()
    : override || config.openaiSttModel;
  const st = await fs.stat(audioPath);
  const size = st.size;
  /** @type {Array<Record<string, unknown>>} */
  const usageSteps = [];
  if (size <= SAFE_CHUNK_BYTES) {
    const ctrl = new AbortController();
    const r = await openaiTranscribeOneFile({
      filePath: audioPath,
      apiKey,
      model,
      translateToEnglish,
      language: openaiLanguage,
      responseFormat: "json",
      signal: ctrl.signal,
    });
    usageSteps.push(usageStepRow({ step: "stt", model, usage: r.usage }));
    return { transcriptText: r.text, openaiClipUsage: buildOpenAiClipUsageReport(usageSteps) };
  }
  const duration = await ffprobeDurationSec(audioPath);
  const silences = await detectSilenceIntervals(audioPath, shouldCancel);
  const plan = planOpusChunksBySizeAndSilence(duration, size, silences);
  /** @type {string[]} */
  const parts = [];
  for (let i = 0; i < plan.length; i++) {
    if (shouldCancel()) throw new Error("CANCELLED");
    const { startSec, endSec } = plan[i];
    const segPath = path.join(workDir, `stt_chunk_${i}.ogg`);
    await extractOpusSegmentFromFile({ inputPath: audioPath, startSec, endSec, outPath: segPath, shouldCancel });
    const ctrl = new AbortController();
    const r = await openaiTranscribeOneFile({
      filePath: segPath,
      apiKey,
      model,
      translateToEnglish,
      language: openaiLanguage,
      responseFormat: "json",
      signal: ctrl.signal,
    });
    usageSteps.push(usageStepRow({ step: "stt_chunk", model, chunkIndex: i, usage: r.usage }));
    if (r.text) parts.push(r.text);
    await fs.unlink(segPath).catch(() => {});
  }
  return { transcriptText: parts.join("\n\n").trim(), openaiClipUsage: buildOpenAiClipUsageReport(usageSteps) };
}

/**
 * @param {object} ctx
 */
async function transcribeNonDiarizedToMergedSrt(ctx) {
  const { audioPath, workDir, subtitles, shouldCancel } = ctx;
  const apiKey = config.openaiApiKey;
  const { translateToEnglish, openaiLanguage } = resolveOpenAiSttLanguages(subtitles);
  const model = translateToEnglish
    ? (process.env.OPENAI_STT_TRANSLATE_MODEL || "whisper-1").trim()
    : config.openaiSttModel;
  const st = await fs.stat(audioPath);
  const size = st.size;
  if (size <= SAFE_CHUNK_BYTES) {
    const ctrl = new AbortController();
    const r = await openaiTranscribeOneFile({
      filePath: audioPath,
      apiKey,
      model,
      translateToEnglish,
      language: openaiLanguage,
      responseFormat: "srt",
      signal: ctrl.signal,
    });
    return r.srt;
  }
  const duration = await ffprobeDurationSec(audioPath);
  const silences = await detectSilenceIntervals(audioPath, shouldCancel);
  const plan = planOpusChunksBySizeAndSilence(duration, size, silences);
  /** @type {string[]} */
  const merged = [];
  let cueIndex = 1;
  for (let i = 0; i < plan.length; i++) {
    if (shouldCancel()) throw new Error("CANCELLED");
    const { startSec, endSec } = plan[i];
    const segPath = path.join(workDir, `stt_srt_${i}.ogg`);
    await extractOpusSegmentFromFile({ inputPath: audioPath, startSec, endSec, outPath: segPath, shouldCancel });
    const ctrl = new AbortController();
    const r = await openaiTranscribeOneFile({
      filePath: segPath,
      apiKey,
      model,
      translateToEnglish,
      language: openaiLanguage,
      responseFormat: "srt",
      signal: ctrl.signal,
    });
    const offsetMs = Math.round(startSec * 1000);
    const shifted = shiftSrtContent(r.srt, offsetMs, cueIndex);
    if (shifted.trim()) {
      const lines = shifted.trim().split(/\n\n+/);
      cueIndex += lines.length;
      merged.push(shifted.trim());
    }
    await fs.unlink(segPath).catch(() => {});
  }
  return merged.join("\n\n").trim();
}

/**
 * Diarized STT (gpt-4o-transcribe-diarize): segments + optional inferred names + SRT for burn.
 *
 * @param {object} ctx
 */
async function transcribeDiarizedPipeline(ctx) {
  const { audioPath, workDir, subtitles, shouldCancel } = ctx;
  const apiKey = config.openaiApiKey;
  const model = config.openaiSttModel;
  const { openaiLanguage } = resolveOpenAiSttLanguages(subtitles);
  const ctrl = new AbortController();

  const st = await fs.stat(audioPath);
  const size = st.size;
  /** @type {Array<{ speaker: string, start: number, end: number, text: string }>} */
  let allSegments = [];
  /** @type {Array<Record<string, unknown>>} */
  const usageSteps = [];

  if (size <= SAFE_CHUNK_BYTES) {
    const di = await openaiTranscribeDiarizedOneFile({
      filePath: audioPath,
      apiKey,
      model,
      language: openaiLanguage,
      signal: ctrl.signal,
    });
    allSegments = di.segments;
    usageSteps.push(usageStepRow({ step: "stt_diarize", model, chunkIndex: 0, usage: di.usage }));
  } else {
    const duration = await ffprobeDurationSec(audioPath);
    const silences = await detectSilenceIntervals(audioPath, shouldCancel);
    const plan = planOpusChunksBySizeAndSilence(duration, size, silences);
    for (let i = 0; i < plan.length; i++) {
      if (shouldCancel()) throw new Error("CANCELLED");
      const { startSec, endSec } = plan[i];
      const segPath = path.join(workDir, `stt_diar_chunk_${i}.ogg`);
      await extractOpusSegmentFromFile({ inputPath: audioPath, startSec, endSec, outPath: segPath, shouldCancel });
      const di = await openaiTranscribeDiarizedOneFile({
        filePath: segPath,
        apiKey,
        model,
        language: openaiLanguage,
        signal: ctrl.signal,
      });
      usageSteps.push(usageStepRow({ step: "stt_diarize", model, chunkIndex: i, usage: di.usage }));
      for (const seg of di.segments) {
        allSegments.push({
          speaker: `c${i}_${seg.speaker}`,
          start: startSec + seg.start,
          end: startSec + seg.end,
          text: seg.text,
        });
      }
      await fs.unlink(segPath).catch(() => {});
    }
  }

  /** @type {Record<string, string>} */
  let speakerLabels = {};
  try {
    const { speakerLabels: inferred, usage: inferUsage } = await inferSpeakerLabelsFromSegmentSamples({
      segments: allSegments,
      apiKey,
      chatModel: config.openaiNewsModel,
      signal: ctrl.signal,
    });
    usageSteps.push(
      usageStepRow({ step: "speaker_infer_chat", model: config.openaiNewsModel, usage: inferUsage }),
    );
    speakerLabels = { ...speakerLabels, ...inferred };
  } catch (e) {
    console.error("[vod-stt] speaker name inference skipped:", e instanceof Error ? e.message : e);
  }

  const transcriptDiarization = { version: 1, segments: allSegments, speakerLabels };
  const transcriptText = formatTranscriptDashLines(allSegments, speakerLabels);
  const srt = diarizedSegmentsToSrt(allSegments, speakerLabels);
  const openaiClipUsage = buildOpenAiClipUsageReport(usageSteps);
  return { transcriptText, transcriptDiarization, srt, openaiClipUsage };
}

/**
 * Transcribe a local audio file (e.g. opus ogg) with chunking; returns plain text + optional diarization payload.
 *
 * @param {object} ctx
 * @param {string} ctx.audioPath
 * @param {string} ctx.workDir
 * @param {object} [ctx.subtitles] same shape as legacy whisper fields on spec
 * @param {() => boolean} ctx.shouldCancel
 * @param {boolean} [ctx.forceNonDiarized] if true, skip diarized pipeline even when OPENAI_STT_MODEL is diarize
 * @param {string} [ctx.sttModelOverride] model for non-diarized path when forcing off diarization
 * @returns {Promise<{ transcriptText: string, transcriptDiarization: object | null, openaiClipUsage: Record<string, unknown> }>}
 */
export async function transcribeAudioFileToPlainText(ctx) {
  const { subtitles, forceNonDiarized } = ctx;
  requireOpenAiKey();
  const model = config.openaiSttModel;
  const { translateToEnglish } = resolveOpenAiSttLanguages(subtitles);

  if (forceNonDiarized || translateToEnglish || !usesDiarizedSttModel(model)) {
    const { transcriptText, openaiClipUsage } = await transcribeNonDiarizedToPlainText(ctx);
    return { transcriptText, transcriptDiarization: null, openaiClipUsage };
  }

  const { transcriptText, transcriptDiarization, openaiClipUsage } = await transcribeDiarizedPipeline(ctx);
  return { transcriptText, transcriptDiarization, openaiClipUsage };
}

/**
 * Transcribe local audio to one merged SRT (for burn-in).
 *
 * @param {object} ctx
 * @param {string} ctx.audioPath
 * @param {string} ctx.workDir
 * @param {object} [ctx.subtitles]
 * @param {() => boolean} ctx.shouldCancel
 * @returns {Promise<string>}
 */
export async function transcribeAudioFileToMergedSrt(ctx) {
  const { subtitles } = ctx;
  requireOpenAiKey();
  const model = config.openaiSttModel;
  const { translateToEnglish } = resolveOpenAiSttLanguages(subtitles);

  if (translateToEnglish || !usesDiarizedSttModel(model)) {
    return transcribeNonDiarizedToMergedSrt(ctx);
  }

  const { srt } = await transcribeDiarizedPipeline(ctx);
  return srt;
}

/**
 * @param {object} opts
 * @param {string} opts.inputMp4
 * @param {string} opts.outPath
 * @param {() => boolean} opts.shouldCancel
 */
async function extractAudioOpusFromMp4(opts) {
  const { inputMp4, outPath, shouldCancel } = opts;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputMp4,
    "-vn",
    "-map",
    "0:a:0",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "libopus",
    "-b:a",
    "48k",
    "-application",
    "voip",
    outPath,
  ];
  await runFfmpeg(args, shouldCancel);
}

/**
 * Escape path for ffmpeg subtitles filter (libavfilter).
 * @param {string} p
 */
function escapeSubtitlesPath(p) {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * @param {string} hex
 * @returns {string} ASS BGR color &H00BBGGRR
 */
function hexToAssColor(hex) {
  const h = String(hex || "")
    .replace("#", "")
    .trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return "&H00FFFFFF";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const pad = (n) => n.toString(16).padStart(2, "0");
  return `&H00${pad(b)}${pad(g)}${pad(r)}`;
}

/**
 * @param {object} opts
 * @param {string} opts.inputMp4
 * @param {string} opts.vf
 * @param {string} opts.outputMp4
 * @param {() => boolean} opts.shouldCancel
 */
async function burnSubtitlesFfmpeg(opts) {
  const { inputMp4, vf, outputMp4, shouldCancel } = opts;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputMp4,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputMp4,
  ];
  await runFfmpeg(args, shouldCancel);
}

/**
 * @typedef {object} SubtitleBurnStyle
 * @property {number} [fontSizePx]
 * @property {string} [textColor] hex #RRGGBB
 * @property {string} [outlineColor] hex #RRGGBB
 * @property {number} [outlineWidthPx]
 */

/**
 * After the main encode, transcribe audio with OpenAI STT and burn subtitles into a new MP4.
 *
 * @param {object} ctx
 * @param {string} ctx.inputMp4
 * @param {string} ctx.workDir
 * @param {SubtitleBurnStyle} ctx.style
 * @param {object} [ctx.subtitles]
 * @param {() => boolean} ctx.shouldCancel
 * @param {(pct: number) => void} [ctx.onProgress]
 * @returns {Promise<{ localPath: string }>}
 */
export async function transcribeAndBurnSubtitles(ctx) {
  const { inputMp4, workDir, style, subtitles, shouldCancel, onProgress } = ctx;
  const opusPath = path.join(workDir, "stt_input.ogg");
  const srtPath = path.join(workDir, "stt_merged.srt");
  const outPath = path.join(workDir, "output_subtitled.mp4");

  onProgress?.(52);
  await extractAudioOpusFromMp4({ inputMp4, outPath: opusPath, shouldCancel });

  onProgress?.(58);
  const mergedSrt = await transcribeAudioFileToMergedSrt({
    audioPath: opusPath,
    workDir,
    subtitles,
    shouldCancel,
  });
  await fs.writeFile(srtPath, mergedSrt, "utf8");

  onProgress?.(76);
  const fontSize = Math.max(8, Math.min(120, Number(style?.fontSizePx) || 28));
  const outlineW = Math.max(0, Math.min(20, Number(style?.outlineWidthPx) || 3));
  const primary = hexToAssColor(style?.textColor);
  const outlineCol = hexToAssColor(style?.outlineColor);

  const fontName = (process.env.VOD_SUBTITLE_FONT_NAME || "DejaVu Sans").trim();
  const forceStyle = `Fontname=${fontName},FontSize=${fontSize},PrimaryColour=${primary},OutlineColour=${outlineCol},Outline=${outlineW},Shadow=0,MarginV=48,Alignment=2,Bold=1`;

  const subsEscaped = escapeSubtitlesPath(srtPath);
  const vf = `subtitles='${subsEscaped}':force_style='${forceStyle}'`;

  onProgress?.(82);
  await burnSubtitlesFfmpeg({ inputMp4, vf, outputMp4: outPath, shouldCancel });

  onProgress?.(88);
  await fs.unlink(opusPath).catch(() => {});
  return { localPath: outPath };
}
