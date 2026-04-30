/**
 * Realtime editor: extract 16 kHz mono WAV from origin HLS (no video re-encode) and run whisper.cpp → plain text.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { ffmpegInputGlobalArgs } from "./vod-ffmpeg-encoder.service.js";
import { transcribeWavFileToPlainText } from "./vod-whisper-subtitles.service.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";
import { spawnFailureMessage } from "../utils/spawn-failure-message.js";
import { config } from "../config.js";
import { generateNewsArticlesFromTvTranscript } from "./openai-news-agent.service.js";

const MIN_SEGMENT_SEC = 0.08;

/**
 * @param {string[]} args
 * @param {() => boolean} shouldCancel
 */
function runFfmpegArgs(args, shouldCancel) {
  return new Promise((resolve, reject) => {
    if (shouldCancel()) {
      reject(new Error("CANCELLED"));
      return;
    }
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
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
      if (code === 0) resolve();
      else {
        const msg = spawnFailureMessage({
          commandLabel: "ffmpeg",
          code: code ?? null,
          signal: signal ?? null,
          stderr,
        });
        reject(new Error(msg.length > 800 ? `${msg.slice(0, 800)}…` : msg));
      }
    });
  });
}

/**
 * Demux+decode audio from HLS (or file) for [start, end] wall-relative seconds; output 16 kHz mono WAV.
 *
 * @param {object} opts
 * @param {string} opts.inputUrl
 * @param {number} opts.start
 * @param {number} opts.end
 * @param {string} opts.wavPath
 * @param {() => boolean} opts.shouldCancel
 */
export async function extractAudioWav16kFromStreamSegment(opts) {
  const { inputUrl, start, end, wavPath, shouldCancel } = opts;
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e - s < MIN_SEGMENT_SEC) {
    throw new Error(`Invalid realtime transcribe range: ${s}–${e}`);
  }
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...ffmpegInputGlobalArgs(inputUrl),
    "-ss",
    String(s),
    "-to",
    String(e),
    "-i",
    inputUrl,
    "-vn",
    "-map",
    "a:0?",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    wavPath,
  ];
  vodEncodeStdout(`realtime-transcribe ffmpeg extract t=${s}-${e}s`);
  await runFfmpegArgs(args, shouldCancel);
}

/**
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.tenantId
 * @param {object} opts.spec
 * @param {() => boolean} opts.shouldCancel
 * @param {(patch: object) => Promise<void>} opts.reportJob
 * @returns {Promise<void>}
 */
export async function runRealtimeTranscribeOnlyJob(opts) {
  const { jobId, spec, shouldCancel, reportJob } = opts;
  const clipUrl = typeof spec?.clipUrl === "string" ? spec.clipUrl.trim() : "";
  const clips = Array.isArray(spec?.clips) ? spec.clips : [];
  const row = clips[0];
  const st = Number(row?.startTime);
  const en = Number(row?.endTime);
  if (!clipUrl) throw new Error("realtimeTranscribeOnly: missing spec.clipUrl");
  if (!row || !Number.isFinite(st) || !Number.isFinite(en) || en <= st) {
    throw new Error("realtimeTranscribeOnly: need spec.clips[0] with valid startTime/endTime");
  }

  const subs =
    row?.subtitles && typeof row.subtitles === "object" && row.subtitles.enabled
      ? row.subtitles
      : spec?.subtitles && typeof spec.subtitles === "object" && spec.subtitles.enabled
        ? spec.subtitles
        : { enabled: true, whisperSourceLanguage: "auto", whisperOutputLanguage: "same" };

  const safeWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), `rt-tr-${jobId}-`));

  const wavPath = path.join(safeWorkDir, "segment.wav");

  try {
    await reportJob({
      status: "processing",
      progress: 10,
      phase: "extracting_audio",
      message: "Extracting audio from stream (no encode)",
    });

    await extractAudioWav16kFromStreamSegment({
      inputUrl: clipUrl,
      start: st,
      end: en,
      wavPath,
      shouldCancel,
    });

    if (shouldCancel()) throw new Error("CANCELLED");

    await reportJob({
      status: "processing",
      progress: 35,
      phase: "transcribing",
      message: "Transcribing (whisper.cpp)",
    });

    const text = await transcribeWavFileToPlainText({
      wavPath,
      workDir: safeWorkDir,
      subtitles: subs,
      shouldCancel,
    });

    if (shouldCancel()) throw new Error("CANCELLED");

    /** @type {Record<string, unknown>} */
    const completionPatch = {
      status: "completed",
      progress: 100,
      phase: "completed",
      message: "Transcript ready",
      transcriptText: text,
    };

    const apiKey = config.openaiApiKey;
    if (apiKey) {
      await reportJob({
        status: "processing",
        progress: 72,
        phase: "generating_news",
        message: "Drafting news articles (OpenAI)…",
      });
      if (shouldCancel()) throw new Error("CANCELLED");
      try {
        const news = await generateNewsArticlesFromTvTranscript({
          apiKey,
          model: config.openaiNewsModel,
          transcriptText: text,
          timeoutMs: config.openaiNewsTimeoutMs,
        });
        completionPatch.transcriptNewsEn = news.en;
        completionPatch.transcriptNewsEs = news.es;
        completionPatch.transcriptNewsHe = news.he;
        completionPatch.message = "Transcript and news ready";
        vodEncodeStdout(`realtime-transcribe openai job=${jobId} en=${news.en.length} es=${news.es.length} he=${news.he.length}`);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        completionPatch.transcriptNewsError = m.slice(0, 600);
        completionPatch.message = "Transcript ready (news generation failed)";
        vodEncodeStdout(`realtime-transcribe openai failed job=${jobId} err=${m.slice(0, 300)}`);
      }
    }

    await reportJob(completionPatch);
    vodEncodeStdout(`realtime-transcribe done job=${jobId} chars=${text.length}`);
  } finally {
    await fs.rm(safeWorkDir, { recursive: true, force: true }).catch(() => {});
  }
}
