/**
 * Orchestrates a single VOD job: ffmpeg → OpenAI STT + burn subs (optional) → S3 upload, reporting state to backend.
 */

import fs from "fs/promises";
import { createReadStream } from "fs";
import os from "os";
import path from "path";
import { encodeEditorJsonToMp4, runFfprobeVideoSize } from "./vod-ffmpeg-encoder.service.js";
import { putVodMp4, putVodHlsDir } from "./vod-s3.service.js";
import { packageMp4ToHls, audioLanguageDisplayName } from "./vod-hls-packager.service.js";
import { runRealtimeTranscribeOnlyJob } from "./vod-realtime-transcribe.service.js";
import {
  transcribeAndBurnSubtitles,
  postEncodeTranscribeFromEncodedMp4,
  ffprobeDurationSec,
} from "./vod-openai-audio-stt.service.js";
import {
  applyInworldDubbingToMp4,
  deleteClonedVoices,
  resolveDubbingTargetLanguages,
} from "./vod-inworld-dubbing.service.js";
import { formatTranscriptDashLines } from "./openai-stt-diarize.service.js";
import {
  generateNewsArticlesFromTvTranscript,
  filterTrilingualNewsByLocaleFlags,
} from "./openai-news-agent.service.js";
import { config } from "../config.js";
import { mergeOpenAiClipUsageReports, logOpenAiClipUsage } from "../utils/openai-usage.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";
import { patchBackendJob } from "./backend-client.service.js";

/** How often to push progress/phase/message to the backend for a fluid UI bar. */
const BACKEND_PROGRESS_TICK_MS = 1000;

/** @type {Map<string, boolean>} */
const cancelFlags = new Map();

/** @type {Map<string, { progress: number, phase: string, message: string }>} */
const progressSnapshotByJob = new Map();

/** @type {Map<string, ReturnType<typeof setInterval>>} */
const progressTickersByJob = new Map();

/**
 * @param {string} jobId
 * @param {object} patch
 * @param {number} [patch.progress]
 * @param {string} [patch.phase]
 * @param {string} [patch.message]
 */
function applyProgressSnapshot(jobId, patch) {
  const cur = progressSnapshotByJob.get(jobId) || {
    progress: 0,
    phase: "queued",
    message: "",
  };
  if (patch.progress !== undefined && patch.progress !== null) {
    cur.progress = Number(patch.progress);
  }
  if (patch.phase !== undefined) {
    cur.phase = String(patch.phase);
  }
  if (patch.message !== undefined) {
    cur.message = String(patch.message);
  }
  progressSnapshotByJob.set(jobId, cur);
}

function pushProgressSnapshotToBackend(jobId) {
  const snap = progressSnapshotByJob.get(jobId);
  if (!snap) return;
  const body = {
    progress: snap.progress,
    phase: snap.phase,
    message: snap.message,
  };
  void patchBackendJob(jobId, body).catch((e) =>
    console.error(`[encoder] job=${jobId} progress tick`, e),
  );
}

/**
 * @param {string} jobId
 */
function startBackendProgressTicker(jobId) {
  if (progressTickersByJob.has(jobId)) return;
  const id = setInterval(() => pushProgressSnapshotToBackend(jobId), BACKEND_PROGRESS_TICK_MS);
  progressTickersByJob.set(jobId, id);
}

/**
 * @param {string} jobId
 */
function stopBackendProgressTicker(jobId) {
  const id = progressTickersByJob.get(jobId);
  if (id) clearInterval(id);
  progressTickersByJob.delete(jobId);
  progressSnapshotByJob.delete(jobId);
}

export function requestCancelJob(jobId) {
  cancelFlags.set(jobId, true);
}

export function clearCancelJob(jobId) {
  cancelFlags.delete(jobId);
}

function shouldCancel(jobId) {
  return cancelFlags.get(jobId) === true;
}

function anySubtitlesEnabled(spec) {
  const s = spec?.subtitles;
  if (s && typeof s === "object" && s.enabled === true) return true;
  return Array.isArray(spec?.clips) && spec.clips.some((c) => c?.subtitles?.enabled === true);
}

/**
 * @param {object} [spec]
 * @returns {boolean}
 */
function anyDubbingEnabled(spec) {
  if (Array.isArray(spec?.clips) && spec.clips.some((c) => c?.dubbing?.enabled === true)) return true;
  return Array.isArray(spec?.dubbingLanguages) && spec.dubbingLanguages.length > 0;
}

/**
 * @param {object} spec
 * @param {object | undefined} clip
 */
function subtitlesConfigForClip(spec, clip) {
  if (clip?.subtitles?.enabled) return clip.subtitles;
  if (spec?.subtitles?.enabled) return spec.subtitles;
  return null;
}

/**
 * Language hints for OpenAI STT when no per-clip subtitles are enabled (defaults to auto).
 * Falls back to dubbing source language when AI dubbing is requested without VTT.
 * @param {object} spec
 */
function subtitlesHintsForSpec(spec) {
  const clipsSorted = [...(spec.clips || [])].sort((a, b) => a.order - b.order);
  for (const row of clipsSorted) {
    const s = subtitlesConfigForClip(spec, row);
    if (s) return s;
  }
  if (spec?.subtitles && typeof spec.subtitles === "object") return spec.subtitles;
  for (const row of clipsSorted) {
    if (row?.dubbing?.enabled === true && row?.dubbing?.sourceLanguage) {
      return { whisperSourceLanguage: row.dubbing.sourceLanguage };
    }
  }
  return undefined;
}

/**
 * @param {object | null | undefined} base
 * @param {object | null | undefined} next
 * @param {number} offsetSec
 */
function mergeTranscriptDiarizationPayloads(base, next, offsetSec) {
  if (!next || typeof next !== "object" || !Array.isArray(next.segments) || next.segments.length === 0) {
    return base && typeof base === "object" ? base : null;
  }
  const nextLabels =
    next.speakerLabels && typeof next.speakerLabels === "object" ? { ...next.speakerLabels } : {};
  const shifted = {
    version: 1,
    segments: next.segments.map((s) => ({
      ...s,
      start: Number(s.start ?? 0) + offsetSec,
      end: Number(s.end ?? 0) + offsetSec,
    })),
    speakerLabels: nextLabels,
  };
  if (!base || typeof base !== "object" || !Array.isArray(base.segments) || base.segments.length === 0) {
    return shifted;
  }
  const baseLabels =
    base.speakerLabels && typeof base.speakerLabels === "object" ? { ...base.speakerLabels } : {};
  return {
    version: 1,
    segments: [...base.segments, ...shifted.segments],
    speakerLabels: { ...baseLabels, ...shifted.speakerLabels },
  };
}

/**
 * @param {string} jobId
 * @param {string} tenantId
 * @param {boolean} burnSubs
 * @param {string} [clipHint]
 */
function logEncodeJobStart(jobId, tenantId, burnSubs, clipHint) {
  const clip = clipHint && clipHint.length > 120 ? `${clipHint.slice(0, 120)}…` : clipHint || "";
  vodEncodeStdout(
    `run start job=${jobId} tenant=${tenantId} subtitles=${burnSubs ? "yes" : "no"}${clip ? ` clipUrl=${clip}` : ""}`,
  );
}

/**
 * @param {string} jobId
 * @param {object} patch
 */
async function reportJob(jobId, patch) {
  if (
    patch.progress !== undefined ||
    patch.phase !== undefined ||
    patch.message !== undefined
  ) {
    applyProgressSnapshot(jobId, patch);
  }
  await patchBackendJob(jobId, patch);
}

/**
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.tenantId
 * @param {object} opts.spec
 * @param {string} [opts.editorClipId] editor sub-clip id (from backend dispatch)
 */
export async function runVodEncodeJob(opts) {
  const { jobId, tenantId, spec, editorClipId } = opts;
  const workDir = path.join(os.tmpdir(), `vod-job-${jobId}`);
  const burnSubs = anySubtitlesEnabled(spec);
  const wantsDubbing = anyDubbingEnabled(spec);

  try {
    logEncodeJobStart(jobId, tenantId, burnSubs, typeof spec?.clipUrl === "string" ? spec.clipUrl : "");

    const clipCount = Array.isArray(spec?.clips) ? spec.clips.length : 0;
    let widgetCount = 0;
    for (const c of spec?.clips || []) {
      if (Array.isArray(c?.widgets)) widgetCount += c.widgets.length;
    }
    vodEncodeStdout(
      `job=${jobId} spec clips=${clipCount} widgetsTotal=${widgetCount} burnSubs=${burnSubs} dubbing=${wantsDubbing ? "yes" : "no"}`,
    );

    if (wantsDubbing && !config.inworldApiKey) {
      throw new Error("AI dubbing requested but INWORLD_API_KEY is not configured on the encoder");
    }
    if (wantsDubbing && !config.openaiApiKey) {
      throw new Error("AI dubbing requires OpenAI STT diarization (OPENAI_API_KEY)");
    }

    if (shouldCancel(jobId)) {
      stopBackendProgressTicker(jobId);
      await reportJob(jobId, {
        status: "cancelled",
        progress: 0,
        phase: "cancelled",
        message: "Cancelled",
      });
      clearCancelJob(jobId);
      return;
    }

    if (spec?.realtimeTranscribeOnly === true) {
      startBackendProgressTicker(jobId);
      try {
        if (shouldCancel(jobId)) throw new Error("CANCELLED");
        await runRealtimeTranscribeOnlyJob({
          jobId,
          tenantId,
          editorClipId,
          spec,
          shouldCancel: () => shouldCancel(jobId),
          reportJob: (patch) => reportJob(jobId, patch),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stopBackendProgressTicker(jobId);
        if (msg === "CANCELLED" || shouldCancel(jobId)) {
          await reportJob(jobId, {
            status: "cancelled",
            progress: 0,
            phase: "cancelled",
            message: "Cancelled",
          });
        } else {
          await reportJob(jobId, {
            status: "failed",
            progress: 0,
            phase: "failed",
            error: msg || "Unknown error",
            message: msg ? `Failed: ${msg.slice(0, 200)}` : "Failed",
          });
        }
        clearCancelJob(jobId);
        return;
      }
      stopBackendProgressTicker(jobId);
      clearCancelJob(jobId);
      return;
    }

    await reportJob(jobId, {
      status: "processing",
      progress: 2,
      phase: "encoding",
      message: "Encoding with ffmpeg",
    });
    startBackendProgressTicker(jobId);

    const wantsPostEncodeStt = (!burnSubs && Boolean(config.openaiApiKey)) || wantsDubbing;
    const encodeProgressCap = burnSubs || wantsPostEncodeStt || wantsDubbing ? 50 : 89;
    const { localPaths, localPath } = await encodeEditorJsonToMp4({
      spec,
      workDir,
      encodeLogPrefix: `job=${jobId}`,
      tenantId,
      jobId,
      shouldCancel: () => shouldCancel(jobId),
      onProgress: (p) => {
        const scaled = 2 + ((p / 90) * (encodeProgressCap - 2));
        applyProgressSnapshot(jobId, {
          progress: Math.max(2, Math.min(encodeProgressCap, Math.round(scaled))),
          phase: "encoding",
          message: "Encoding with ffmpeg",
        });
      },
    });

    const n = Array.isArray(localPaths) ? localPaths.length : 0;
    vodEncodeStdout(`job=${jobId} ffmpeg segments done count=${n} workDir=${workDir}`);

    if (shouldCancel(jobId)) {
      stopBackendProgressTicker(jobId);
      await reportJob(jobId, {
        status: "cancelled",
        progress: 0,
        phase: "cancelled",
        message: "Cancelled",
      });
      return;
    }

    /** @type {string[]} */
    let pathsToUpload =
      Array.isArray(localPaths) && localPaths.length > 0 ? [...localPaths] : [localPath].filter(Boolean);

    /** @type {string[]} */
    const aggregatedTranscriptParts = [];
    /** @type {object | null} */
    let aggregatedDi = null;
    /** @type {(object | null)[]} */
    const diarizationPerClip = [];
    /** @type {Record<string, unknown> | null | undefined} */
    let aggregatedUsage = null;
    let timeOffsetSec = 0;

    // Dubbing forces speaker diarization even when the root flag is false.
    const speakerDiarization = wantsDubbing || spec?.transcribeSpeakerDiarization !== false;
    const sttHints = subtitlesHintsForSpec(spec);
    const nSeg = pathsToUpload.length;

    if (burnSubs) {
      const clipsSorted = [...(spec.clips || [])].sort((a, b) => a.order - b.order);
      const subtitled = [];
      for (let i = 0; i < nSeg; i++) {
        const clipRow = clipsSorted[i];
        const subs = subtitlesConfigForClip(spec, clipRow);
        if (!subs) {
          subtitled.push(pathsToUpload[i]);
          diarizationPerClip[i] = null;
          try {
            timeOffsetSec += await ffprobeDurationSec(pathsToUpload[i]);
          } catch {
            /* ignore */
          }
          continue;
        }
        const style = subs.style || {};
        const subWorkDir = path.join(workDir, `subs_clip_${i}`);
        await fs.mkdir(subWorkDir, { recursive: true });
        await reportJob(jobId, {
          status: "processing",
          progress: 50,
          phase: "transcribing",
          message:
            nSeg > 1
              ? `Transcribing audio (OpenAI STT) — clip ${i + 1}/${nSeg}`
              : "Transcribing audio (OpenAI STT)",
        });
        const sliceStart = 50 + (i / nSeg) * 38;
        const sliceEnd = 50 + ((i + 1) / nSeg) * 38;
        const mapPct = (pct) => sliceStart + ((pct - 52) / (88 - 52)) * (sliceEnd - sliceStart);
        const { localPath: subPath, transcriptText, transcriptDiarization, openaiClipUsage } =
          await transcribeAndBurnSubtitles({
            inputMp4: pathsToUpload[i],
            workDir: subWorkDir,
            style,
            subtitles: subs,
            speakerDiarization,
            shouldCancel: () => shouldCancel(jobId),
            onProgress: (pct) => {
              const phase = pct < 72 ? "transcribing" : "burning_subtitles";
              const msg =
                phase === "transcribing"
                  ? nSeg > 1
                    ? `Transcribing clip ${i + 1}/${nSeg}`
                    : "Transcribing audio (OpenAI STT)"
                  : nSeg > 1
                    ? `Burning subtitles (clip ${i + 1}/${nSeg})`
                    : "Burning subtitles into video";
              applyProgressSnapshot(jobId, {
                progress: Math.max(50, Math.min(89, Math.round(mapPct(pct)))),
                phase,
                message: msg,
              });
            },
          });
        subtitled.push(subPath);
        diarizationPerClip[i] =
          transcriptDiarization && typeof transcriptDiarization === "object" ? transcriptDiarization : null;
        if (transcriptText?.trim()) aggregatedTranscriptParts.push(String(transcriptText).trim());
        aggregatedDi = mergeTranscriptDiarizationPayloads(aggregatedDi, transcriptDiarization, timeOffsetSec);
        aggregatedUsage = mergeOpenAiClipUsageReports(aggregatedUsage, openaiClipUsage);
        try {
          timeOffsetSec += await ffprobeDurationSec(subPath);
        } catch {
          /* ignore */
        }
      }
      pathsToUpload = subtitled;
    } else if (wantsPostEncodeStt) {
      for (let i = 0; i < nSeg; i++) {
        const subWorkDir = path.join(workDir, `post_stt_${i}`);
        await fs.mkdir(subWorkDir, { recursive: true });
        const sliceStart = 50 + (i / nSeg) * 38;
        const sliceEnd = 50 + ((i + 1) / nSeg) * 38;
        await reportJob(jobId, {
          status: "processing",
          progress: Math.round(sliceStart),
          phase: "transcribing",
          message:
            nSeg > 1
              ? `Transcribing audio (OpenAI STT) — clip ${i + 1}/${nSeg}`
              : "Transcribing audio (OpenAI STT)",
        });
        const stt = await postEncodeTranscribeFromEncodedMp4({
          inputMp4: pathsToUpload[i],
          workDir: subWorkDir,
          subtitles: sttHints,
          speakerDiarization,
          inferSpeakerNames: spec?.transcribeInferSpeakerNames === true,
          shouldCancel: () => shouldCancel(jobId),
        });
        applyProgressSnapshot(jobId, {
          progress: Math.max(50, Math.min(89, Math.round(sliceEnd))),
          phase: "transcribing",
          message:
            nSeg > 1 ? `Transcribed clip ${i + 1}/${nSeg} (OpenAI STT)` : "Transcribed audio (OpenAI STT)",
        });
        diarizationPerClip[i] =
          stt.transcriptDiarization && typeof stt.transcriptDiarization === "object"
            ? stt.transcriptDiarization
            : null;
        if (stt.transcriptText?.trim()) aggregatedTranscriptParts.push(String(stt.transcriptText).trim());
        aggregatedDi = mergeTranscriptDiarizationPayloads(aggregatedDi, stt.transcriptDiarization, timeOffsetSec);
        aggregatedUsage = mergeOpenAiClipUsageReports(aggregatedUsage, stt.openaiClipUsage);
        try {
          timeOffsetSec += await ffprobeDurationSec(pathsToUpload[i]);
        } catch {
          /* ignore */
        }
      }
    }

    /** @type {Record<string, unknown>} */
    const transcriptCompletion = {};
    const joinedPlain = aggregatedTranscriptParts.filter(Boolean).join("\n\n---\n\n").trim();
    if (aggregatedDi && Array.isArray(aggregatedDi.segments) && aggregatedDi.segments.length > 0) {
      transcriptCompletion.transcriptDiarization = aggregatedDi;
      transcriptCompletion.transcriptText = formatTranscriptDashLines(
        aggregatedDi.segments,
        aggregatedDi.speakerLabels && typeof aggregatedDi.speakerLabels === "object"
          ? aggregatedDi.speakerLabels
          : {},
      );
    } else if (joinedPlain) {
      transcriptCompletion.transcriptText = joinedPlain;
    }
    if (aggregatedUsage && typeof aggregatedUsage === "object") {
      transcriptCompletion.openaiClipUsage = aggregatedUsage;
    }

    const textForNews = String(transcriptCompletion.transcriptText || "").trim();
    if (spec?.transcribeGenerateNews !== false && config.openaiApiKey && textForNews) {
      await reportJob(jobId, {
        status: "processing",
        progress: 88,
        phase: "generating_news",
        message: "Drafting news articles (OpenAI)…",
      });
      try {
        const newsRaw = await generateNewsArticlesFromTvTranscript({
          apiKey: config.openaiApiKey,
          model: config.openaiNewsModel,
          transcriptText: textForNews,
          timeoutMs: config.openaiNewsTimeoutMs,
        });
        const news = filterTrilingualNewsByLocaleFlags(newsRaw, spec?.transcribeNewsLocales);
        transcriptCompletion.transcriptNewsBundle = news.bundle;
        transcriptCompletion.transcriptNewsEn = news.legacyPlain.en;
        transcriptCompletion.transcriptNewsEs = news.legacyPlain.es;
        transcriptCompletion.transcriptNewsHe = news.legacyPlain.he;
        transcriptCompletion.openaiClipUsage = mergeOpenAiClipUsageReports(
          /** @type {Record<string, unknown>} */ (transcriptCompletion.openaiClipUsage),
          /** @type {Record<string, unknown>} */ (news.openaiClipUsage),
        );
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        transcriptCompletion.transcriptNewsError = m.slice(0, 600);
      }
    }

    if (transcriptCompletion.openaiClipUsage && typeof transcriptCompletion.openaiClipUsage === "object") {
      logOpenAiClipUsage(jobId, "vod_encode", transcriptCompletion.openaiClipUsage);
    }

    // AI dubbing (Inworld): clone voices, translate, TTS time-fit, mux multi-audio.
    /** @type {string[]} */
    let ephemeralVoiceIds = [];
    /**
     * Per-clip dubbed target languages actually muxed into pathsToUpload[i] (index-aligned).
     * Empty array = no extra audio track for that clip.
     * @type {string[][]}
     */
    const dubbedLangsPerClip = new Array(pathsToUpload.length).fill(null).map(() => []);
    if (wantsDubbing) {
      const clipsSortedForDub = [...(spec.clips || [])].sort((a, b) => a.order - b.order);
      const dubbedPaths = [];
      try {
        for (let i = 0; i < pathsToUpload.length; i++) {
          if (shouldCancel(jobId)) throw new Error("CANCELLED");
          const clipRow = clipsSortedForDub[i];
          const targets = resolveDubbingTargetLanguages(clipRow, spec);
          const clipWants = clipRow?.dubbing?.enabled === true && targets.length > 0;
          if (!clipWants) {
            dubbedPaths.push(pathsToUpload[i]);
            continue;
          }
          const di = diarizationPerClip[i];
          if (!di || !Array.isArray(di.segments) || di.segments.length === 0) {
            throw new Error(
              `AI dubbing requires diarized STT for clip ${i + 1}; no speaker segments were produced`,
            );
          }
          const dubWorkDir = path.join(workDir, `dub_clip_${i}`);
          await fs.mkdir(dubWorkDir, { recursive: true });
          await reportJob(jobId, {
            status: "processing",
            progress: 89,
            phase: "dubbing",
            message:
              pathsToUpload.length > 1
                ? `AI dubbing (Inworld) — clip ${i + 1}/${pathsToUpload.length}`
                : "AI dubbing (Inworld): cloning voices & synthesizing",
          });
          const result = await applyInworldDubbingToMp4({
            inputMp4: pathsToUpload[i],
            workDir: dubWorkDir,
            diarization: di,
            clip: clipRow,
            spec,
            shouldCancel: () => shouldCancel(jobId),
            onProgress: (pct, message) => {
              applyProgressSnapshot(jobId, {
                progress: Math.max(89, Math.min(91, 89 + Math.round((pct / 100) * 2))),
                phase: "dubbing",
                message: message || "AI dubbing (Inworld)",
              });
            },
          });
          if (Array.isArray(result.voiceIds)) ephemeralVoiceIds.push(...result.voiceIds);
          dubbedPaths.push(result.outputMp4);
          dubbedLangsPerClip[i] = Array.isArray(result.targetLanguages)
            ? result.targetLanguages.map((l) => String(l).toLowerCase()).filter(Boolean)
            : [];
          vodEncodeStdout(
            `job=${jobId} dubbing clip=${i + 1} langs=${(result.targetLanguages || []).join(",") || "none"}`,
          );
        }
        pathsToUpload = dubbedPaths;
      } finally {
        if (ephemeralVoiceIds.length) {
          await deleteClonedVoices(ephemeralVoiceIds);
          ephemeralVoiceIds = [];
        }
      }
    }

    if (shouldCancel(jobId)) {
      stopBackendProgressTicker(jobId);
      await reportJob(jobId, {
        status: "cancelled",
        progress: 0,
        phase: "cancelled",
        message: "Cancelled",
      });
      return;
    }

    await reportJob(jobId, {
      status: "processing",
      progress: 92,
      phase: "uploading",
      message: "Uploading to storage",
    });

    const clipsSorted = [...(spec.clips || [])].sort((a, b) => a.order - b.order);
    /** @type {(string|null)[]} */
    const outputUrls = [];
    /** @type {string[]} */
    const s3Keys = [];
    /** @type {Array<{ kind: "hls" | "mp4", label: string, url: string }>} */
    const outputAssets = [];
    const uploadTotal = pathsToUpload.length;
    for (let i = 0; i < uploadTotal; i++) {
      const order = clipsSorted[i]?.order ?? i + 1;
      const fileName = uploadTotal > 1 ? `${jobId}-clip${order}.mp4` : `${jobId}.mp4`;
      const stream = createReadStream(pathsToUpload[i]);
      const { key, publicUrl } = await putVodMp4(tenantId, fileName, stream);
      s3Keys.push(key);

      // Label prefix for multi-clip jobs so the UI tabs are distinguishable.
      const clipPrefix = uploadTotal > 1 ? `Clip ${order} · ` : "";
      // MP4 resolution for the tab label (best-effort; falls back to plain "MP4").
      let mp4Label = `${clipPrefix}MP4`;
      try {
        const { width, height } = await runFfprobeVideoSize(pathsToUpload[i]);
        if (width && height) mp4Label = `${clipPrefix}MP4 ${width}x${height}`;
      } catch {
        /* keep plain label */
      }
      if (publicUrl) {
        outputAssets.push({ kind: "mp4", label: mp4Label, url: publicUrl });
      }

      // When this clip has dubbed audio track(s), also publish an HLS asset that exposes
      // every audio rendition (original + dubs) as a selectable language. The HLS master
      // becomes the primary output URL so players get an audio-language selector; the MP4
      // stays uploaded as a download/compat fallback.
      const dubLangs = Array.isArray(dubbedLangsPerClip[i]) ? dubbedLangsPerClip[i] : [];
      let outputUrl = publicUrl || null;
      if (dubLangs.length > 0) {
        try {
          const hlsOutDir = path.join(workDir, `hls_clip_${i}`);
          const audioTracks = [
            { lang: "und", name: "Original", default: true },
            ...dubLangs.map((l) => ({ lang: l, name: audioLanguageDisplayName(l), default: false })),
          ];
          await packageMp4ToHls({
            inputMp4: pathsToUpload[i],
            audioTracks,
            outDir: hlsOutDir,
            shouldCancel: () => shouldCancel(jobId),
            logPrefix: `job=${jobId}`,
          });
          const clipTag = uploadTotal > 1 ? `clip${order}` : undefined;
          const { masterKey, masterUrl } = await putVodHlsDir(tenantId, jobId, clipTag, hlsOutDir);
          if (masterUrl) {
            outputUrl = masterUrl;
            s3Keys.push(masterKey);
            outputAssets.push({
              kind: "hls",
              label: `${uploadTotal > 1 ? `Clip ${order} · ` : ""}HLS · ${dubLangs.length + 1} audios`,
              url: masterUrl,
            });
            vodEncodeStdout(
              `job=${jobId} hls multi-audio clip=${i + 1} langs=${dubLangs.join(",")} master=${masterUrl}`,
            );
          }
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          console.error(`[vod] HLS multi-audio packaging failed job=${jobId} clip=${i + 1}: ${m}`);
        }
      }

      outputUrls.push(outputUrl);
      if (uploadTotal > 1) {
        applyProgressSnapshot(jobId, {
          progress: 92 + Math.round(((i + 1) / uploadTotal) * 7),
          phase: "uploading",
          message: `Uploading clip ${i + 1}/${uploadTotal}`,
        });
      }
    }

    stopBackendProgressTicker(jobId);
    await reportJob(jobId, {
      status: "completed",
      progress: 100,
      phase: "completed",
      message: "Done",
      s3Key: s3Keys[0],
      s3Keys,
      outputUrl: outputUrls[0] ?? null,
      outputUrls,
      ...(outputAssets.length ? { outputAssets } : {}),
      ...transcriptCompletion,
    });
    vodEncodeStdout(`job=${jobId} done tenant=${tenantId} keys=${s3Keys.join(",")}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stopBackendProgressTicker(jobId);
    if (msg === "CANCELLED" || shouldCancel(jobId)) {
      await reportJob(jobId, {
        status: "cancelled",
        progress: 0,
        phase: "cancelled",
        message: "Cancelled",
      });
      vodEncodeStdout(`job=${jobId} cancelled tenant=${tenantId}`);
    } else {
      console.error(`[vod] FAILED job=${jobId} tenant=${tenantId}`);
      console.error(`[vod] error: ${msg || "(empty message)"}`);
      if (err instanceof Error && err.stack) {
        console.error("[vod] stack:");
        console.error(err.stack);
      } else {
        console.error("[vod] raw:", err);
      }
      await reportJob(jobId, {
        status: "failed",
        progress: 0,
        phase: "failed",
        error: msg || "Unknown error",
        message: msg ? `Failed: ${msg.slice(0, 200)}` : "Failed",
      });
    }
  } finally {
    stopBackendProgressTicker(jobId);
    clearCancelJob(jobId);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
