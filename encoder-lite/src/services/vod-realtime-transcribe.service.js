/**
 * Realtime editor: extract lightweight mono Opus from origin HLS (ffmpeg only) and transcribe via OpenAI STT → plain text + optional news.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  extractLightweightMonoOpusOgg,
  transcribeAudioFileToPlainText,
} from "./vod-openai-audio-stt.service.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";
import { config } from "../config.js";
import {
  generateNewsArticlesFromTvTranscript,
  filterTrilingualNewsByLocaleFlags,
} from "./openai-news-agent.service.js";
import { usesDiarizedSttModel } from "./openai-stt-diarize.service.js";
import { logRealtimeTranscribeClipOpenAiCost, mergeOpenAiClipUsageReports } from "../utils/openai-usage.js";

const MIN_SEGMENT_SEC = 0.08;

/**
 * Demux audio from HLS (or file) for [start, end] seconds on the clip timeline; output lightweight mono Opus in Ogg (never sent to OpenAI as URL).
 *
 * @param {object} opts
 * @param {string} opts.inputUrl
 * @param {number} opts.start
 * @param {number} opts.end
 * @param {string} opts.outPath
 * @param {() => boolean} opts.shouldCancel
 */
export async function extractAudioOpusFromStreamSegment(opts) {
  const { inputUrl, start, end, outPath, shouldCancel } = opts;
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e - s < MIN_SEGMENT_SEC) {
    throw new Error(`Invalid realtime transcribe range: ${s}–${e}`);
  }
  vodEncodeStdout(`realtime-transcribe ffmpeg extract opus t=${s}-${e}s`);
  await extractLightweightMonoOpusOgg({
    inputPathOrUrl: inputUrl,
    startSec: s,
    endSec: e,
    outPath,
    shouldCancel,
  });
}

/**
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} [opts.tenantId]
 * @param {string} [opts.editorClipId]
 * @param {object} opts.spec
 * @param {() => boolean} opts.shouldCancel
 * @param {(patch: object) => Promise<void>} opts.reportJob
 * @returns {Promise<void>}
 */
export async function runRealtimeTranscribeOnlyJob(opts) {
  const { jobId, tenantId, editorClipId, spec, shouldCancel, reportJob } = opts;
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

  const speakerDiarization = spec?.transcribeSpeakerDiarization !== false;
  const generateNews = spec?.transcribeGenerateNews !== false;
  const nonDiarizeModel = (process.env.OPENAI_STT_NON_DIARIZE_MODEL || "gpt-4o-mini-transcribe").trim();
  const sttModelOverride =
    !speakerDiarization && usesDiarizedSttModel(config.openaiSttModel) ? nonDiarizeModel : undefined;

  const safeWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), `rt-tr-${jobId}-`));

  const opusPath = path.join(safeWorkDir, "segment.ogg");
  const clipAudioSeconds = Number.isFinite(en - st) ? Math.max(0, en - st) : 0;
  /** Whether trilingual news ran successfully (for cost log). */
  let newsIncludedInCost = false;

  try {
    await reportJob({
      status: "processing",
      progress: 10,
      phase: "extracting_audio",
      message: "Extracting lightweight audio from stream (ffmpeg)",
    });

    await extractAudioOpusFromStreamSegment({
      inputUrl: clipUrl,
      start: st,
      end: en,
      outPath: opusPath,
      shouldCancel,
    });

    if (shouldCancel()) throw new Error("CANCELLED");

    await reportJob({
      status: "processing",
      progress: 35,
      phase: "transcribing",
      message: "Transcribing (OpenAI STT)",
    });

    const stt = await transcribeAudioFileToPlainText({
      audioPath: opusPath,
      workDir: safeWorkDir,
      subtitles: subs,
      shouldCancel,
      forceNonDiarized: !speakerDiarization,
      sttModelOverride,
    });

    if (shouldCancel()) throw new Error("CANCELLED");

    /** @type {Record<string, unknown>} */
    const completionPatch = {
      status: "completed",
      progress: 100,
      phase: "completed",
      message: "Transcript ready",
      transcriptText: stt.transcriptText,
    };
    if (stt.transcriptDiarization && typeof stt.transcriptDiarization === "object") {
      completionPatch.transcriptDiarization = stt.transcriptDiarization;
    }
    if (stt.openaiClipUsage && typeof stt.openaiClipUsage === "object") {
      completionPatch.openaiClipUsage = stt.openaiClipUsage;
    }

    await reportJob({
      status: "processing",
      progress: 58,
      phase: "transcribing",
      message: "Transcript ready (OpenAI usage saved)",
      transcriptText: stt.transcriptText,
      ...(stt.transcriptDiarization && typeof stt.transcriptDiarization === "object"
        ? { transcriptDiarization: stt.transcriptDiarization }
        : {}),
      openaiClipUsage: stt.openaiClipUsage,
    });

    const apiKey = config.openaiApiKey;
    if (apiKey && generateNews) {
      await reportJob({
        status: "processing",
        progress: 72,
        phase: "generating_news",
        message: "Drafting news articles (OpenAI)…",
      });
      if (shouldCancel()) throw new Error("CANCELLED");
      try {
        const newsRaw = await generateNewsArticlesFromTvTranscript({
          apiKey,
          model: config.openaiNewsModel,
          transcriptText: stt.transcriptText,
          timeoutMs: config.openaiNewsTimeoutMs,
        });
        const news = filterTrilingualNewsByLocaleFlags(newsRaw, spec?.transcribeNewsLocales);
        completionPatch.transcriptNewsBundle = news.bundle;
        completionPatch.transcriptNewsEn = news.legacyPlain.en;
        completionPatch.transcriptNewsEs = news.legacyPlain.es;
        completionPatch.transcriptNewsHe = news.legacyPlain.he;
        completionPatch.message = "Transcript and news ready";
        completionPatch.openaiClipUsage = mergeOpenAiClipUsageReports(
          /** @type {Record<string, unknown>} */ (stt.openaiClipUsage),
          /** @type {Record<string, unknown>} */ (news.openaiClipUsage),
        );
        newsIncludedInCost = true;
        vodEncodeStdout(
          `realtime-transcribe openai job=${jobId} bundle=v${news.bundle.version} enChars=${news.legacyPlain.en.length}`,
        );
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        completionPatch.transcriptNewsError = m.slice(0, 600);
        completionPatch.message = "Transcript ready (news generation failed)";
        vodEncodeStdout(`realtime-transcribe openai failed job=${jobId} err=${m.slice(0, 300)}`);
      }
    } else if (!generateNews) {
      completionPatch.message = "Transcript ready (news skipped)";
    }

    await reportJob(completionPatch);
    logRealtimeTranscribeClipOpenAiCost({
      jobId,
      tenantId,
      editorClipId,
      clipAudioSeconds,
      report: /** @type {Record<string, unknown>} */ (completionPatch.openaiClipUsage),
      newsIncluded: newsIncludedInCost,
    });
    vodEncodeStdout(`realtime-transcribe done job=${jobId} chars=${String(stt.transcriptText || "").length}`);
  } finally {
    await fs.rm(safeWorkDir, { recursive: true, force: true }).catch(() => {});
  }
}
