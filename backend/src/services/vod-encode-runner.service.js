/**
 * Orchestrates a single VOD job: ffmpeg encode (pluggable) → S3 upload → local cleanup.
 */

import fs from "fs/promises";
import { createReadStream } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { encodeEditorJsonToMp4 } from "./vod-encode-adapter.service.js";
import { putVodMp4 } from "./vod-s3.service.js";
import { createJob, updateJob } from "./vod-jobs.store.js";
import { transcribeAndBurnSubtitles } from "./vod-whisper-subtitles.service.js";

/** @type {Map<string, boolean>} */
const cancelFlags = new Map();

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
 * @param {object} spec
 * @param {object | undefined} clip ordered row from spec.clips
 */
function subtitlesConfigForClip(spec, clip) {
  if (clip?.subtitles?.enabled) return clip.subtitles;
  if (spec?.subtitles?.enabled) return spec.subtitles;
  return null;
}

/**
 * @param {string} jobId
 * @param {string} tenantId
 * @param {boolean} burnSubs
 * @param {string} [clipHint]
 */
function logVodInfo(jobId, tenantId, burnSubs, clipHint) {
  const clip = clipHint && clipHint.length > 120 ? `${clipHint.slice(0, 120)}…` : clipHint || "";
  console.log(
    `[vod] start job=${jobId} tenant=${tenantId} subtitles=${burnSubs ? "yes" : "no"}${clip ? ` clip=${clip}` : ""}`,
  );
}

export async function runVodEncodeJob(opts) {
  const { jobId, tenantId, spec } = opts;
  const workDir = path.join(os.tmpdir(), `vod-job-${jobId}`);
  const burnSubs = anySubtitlesEnabled(spec);

  try {
    logVodInfo(jobId, tenantId, burnSubs, typeof spec?.clipUrl === "string" ? spec.clipUrl : "");

    if (shouldCancel(jobId)) {
      updateJob(jobId, {
        status: "cancelled",
        progress: 0,
        phase: "cancelled",
        message: "Cancelled",
      });
      clearCancelJob(jobId);
      return;
    }

    updateJob(jobId, {
      status: "processing",
      progress: 2,
      phase: "encoding",
      message: "Encoding with ffmpeg",
    });

    const encodeProgressCap = burnSubs ? 50 : 89;
    const { localPaths, localPath } = await encodeEditorJsonToMp4({
      spec,
      workDir,
      shouldCancel: () => shouldCancel(jobId),
      onProgress: (p) => {
        const scaled = 2 + ((p / 90) * (encodeProgressCap - 2));
        updateJob(jobId, {
          progress: Math.max(2, Math.min(encodeProgressCap, Math.round(scaled))),
          phase: "encoding",
        });
      },
    });

    if (shouldCancel(jobId)) {
      updateJob(jobId, {
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

    if (burnSubs) {
      const clipsSorted = [...(spec.clips || [])].sort((a, b) => a.order - b.order);
      const n = pathsToUpload.length;
      const subtitled = [];
      for (let i = 0; i < n; i++) {
        const clipRow = clipsSorted[i];
        const subs = subtitlesConfigForClip(spec, clipRow);
        if (!subs) {
          subtitled.push(pathsToUpload[i]);
          continue;
        }
        const style = subs.style || {};
        const subWorkDir = path.join(workDir, `subs_clip_${i}`);
        await fs.mkdir(subWorkDir, { recursive: true });
        updateJob(jobId, {
          status: "processing",
          progress: 50,
          phase: "transcribing",
          message:
            n > 1
              ? `Transcribing audio (whisper.cpp) — clip ${i + 1}/${n}`
              : "Transcribing audio (whisper.cpp)",
        });
        const sliceStart = 50 + (i / n) * 38;
        const sliceEnd = 50 + ((i + 1) / n) * 38;
        const mapPct = (pct) => sliceStart + ((pct - 52) / (88 - 52)) * (sliceEnd - sliceStart);
        const { localPath: subPath } = await transcribeAndBurnSubtitles({
          inputMp4: pathsToUpload[i],
          workDir: subWorkDir,
          style,
          subtitles: subs,
          shouldCancel: () => shouldCancel(jobId),
          onProgress: (pct) => {
            const phase = pct < 72 ? "transcribing" : "burning_subtitles";
            const msg =
              phase === "transcribing"
                ? n > 1
                  ? `Transcribing clip ${i + 1}/${n}`
                  : "Transcribing audio (whisper.cpp)"
                : n > 1
                  ? `Burning subtitles (clip ${i + 1}/${n})`
                  : "Burning subtitles into video";
            updateJob(jobId, {
              progress: Math.max(50, Math.min(89, Math.round(mapPct(pct)))),
              phase,
              message: msg,
            });
          },
        });
        subtitled.push(subPath);
      }
      pathsToUpload = subtitled;
    }

    if (shouldCancel(jobId)) {
      updateJob(jobId, {
        status: "cancelled",
        progress: 0,
        phase: "cancelled",
        message: "Cancelled",
      });
      return;
    }

    updateJob(jobId, {
      status: "uploading",
      progress: 92,
      phase: "uploading",
      message: "Uploading to storage",
    });

    const clipsSorted = [...(spec.clips || [])].sort((a, b) => a.order - b.order);
    /** @type {(string|null)[]} */
    const outputUrls = [];
    /** @type {string[]} */
    const s3Keys = [];
    const uploadTotal = pathsToUpload.length;
    for (let i = 0; i < uploadTotal; i++) {
      const order = clipsSorted[i]?.order ?? i + 1;
      const fileName = uploadTotal > 1 ? `${jobId}-clip${order}.mp4` : `${jobId}.mp4`;
      const stream = createReadStream(pathsToUpload[i]);
      const { key, publicUrl } = await putVodMp4(tenantId, fileName, stream);
      s3Keys.push(key);
      outputUrls.push(publicUrl || null);
      if (uploadTotal > 1) {
        updateJob(jobId, {
          progress: 92 + Math.round(((i + 1) / uploadTotal) * 7),
          phase: "uploading",
          message: `Uploading clip ${i + 1}/${uploadTotal}`,
        });
      }
    }

    updateJob(jobId, {
      status: "completed",
      progress: 100,
      phase: "completed",
      message: "Done",
      s3Key: s3Keys[0],
      s3Keys,
      outputUrl: outputUrls[0] ?? null,
      outputUrls,
    });
    console.log(
      `[vod] done job=${jobId} tenant=${tenantId} keys=${s3Keys.join(",")}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "CANCELLED" || shouldCancel(jobId)) {
      updateJob(jobId, {
        status: "cancelled",
        progress: 0,
        phase: "cancelled",
        message: "Cancelled",
      });
      console.log(`[vod] cancelled job=${jobId} tenant=${tenantId}`);
    } else {
      console.error(`[vod] FAILED job=${jobId} tenant=${tenantId}`);
      console.error(`[vod] error: ${msg || "(empty message)"}`);
      if (err instanceof Error && err.stack) {
        console.error("[vod] stack:");
        console.error(err.stack);
      } else {
        console.error("[vod] raw:", err);
      }
      updateJob(jobId, {
        status: "failed",
        progress: 0,
        phase: "failed",
        error: msg || "Unknown error",
        message: msg ? `Failed: ${msg.slice(0, 200)}` : "Failed",
      });
    }
  } finally {
    clearCancelJob(jobId);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Fire-and-forget job start (Node microtask).
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {import('./vod-ffmpeg-encoder.service.js').EditorEncodeSpec} opts.spec
 * @param {string} [opts.clipUrlPreview]
 * @param {string} [opts.editorClipId]
 */
export function startBackgroundVodJob(opts) {
  const jobId = randomUUID();
  const { tenantId, spec, clipUrlPreview, editorClipId } = opts;

  createJob({
    id: jobId,
    tenantId,
    status: "queued",
    progress: 0,
    phase: "queued",
    message: "Queued",
    clipUrl: clipUrlPreview || spec.clipUrl,
    ...(editorClipId ? { editorClipId } : {}),
  });

  const subs = anySubtitlesEnabled(spec);
  console.log(`[vod] queued job=${jobId} tenant=${tenantId} subtitles=${subs ? "yes" : "no"}`);

  queueMicrotask(() => {
    // runVodEncodeJob catches internally; this only fires on unexpected bugs
    void runVodEncodeJob({ jobId, tenantId, spec }).catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[vod] unexpected rejection job=${jobId}`, m);
      if (e instanceof Error && e.stack) console.error(e.stack);
      updateJob(jobId, {
        status: "failed",
        error: m,
        phase: "failed",
        message: `Failed: ${m.slice(0, 200)}`,
      });
    });
  });

  return jobId;
}
