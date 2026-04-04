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

function subtitlesEnabled(spec) {
  const s = spec?.subtitles;
  return !!(s && typeof s === "object" && s.enabled === true);
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
  const burnSubs = subtitlesEnabled(spec);

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
    const { localPath: encodedPath } = await encodeEditorJsonToMp4({
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

    let uploadPath = encodedPath;
    if (burnSubs) {
      updateJob(jobId, {
        status: "processing",
        progress: 52,
        phase: "transcribing",
        message: "Transcribing audio (whisper.cpp)",
      });
      const style = spec.subtitles?.style || {};
      const { localPath: subtitledPath } = await transcribeAndBurnSubtitles({
        inputMp4: encodedPath,
        workDir,
        style,
        shouldCancel: () => shouldCancel(jobId),
        onProgress: (pct) => {
          const phase = pct < 72 ? "transcribing" : "burning_subtitles";
          const msg =
            phase === "transcribing" ? "Transcribing audio (whisper.cpp)" : "Burning subtitles into video";
          updateJob(jobId, {
            progress: Math.max(50, Math.min(90, Math.round(pct))),
            phase,
            message: msg,
          });
        },
      });
      uploadPath = subtitledPath;
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

    const fileName = `${jobId}.mp4`;
    const stream = createReadStream(uploadPath);
    const { key, publicUrl } = await putVodMp4(tenantId, fileName, stream);

    updateJob(jobId, {
      status: "completed",
      progress: 100,
      phase: "completed",
      message: "Done",
      s3Key: key,
      outputUrl: publicUrl || null,
    });
    console.log(`[vod] done job=${jobId} tenant=${tenantId} key=${key}`);
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
 */
export function startBackgroundVodJob(opts) {
  const jobId = randomUUID();
  const { tenantId, spec, clipUrlPreview } = opts;

  createJob({
    id: jobId,
    tenantId,
    status: "queued",
    progress: 0,
    phase: "queued",
    message: "Queued",
    clipUrl: clipUrlPreview || spec.clipUrl,
  });

  const subs = subtitlesEnabled(spec);
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
