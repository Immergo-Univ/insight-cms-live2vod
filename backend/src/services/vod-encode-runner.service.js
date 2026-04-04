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

/**
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.tenantId
 * @param {import('./vod-ffmpeg-encoder.service.js').EditorEncodeSpec} opts.spec
 */
export async function runVodEncodeJob(opts) {
  const { jobId, tenantId, spec } = opts;
  const workDir = path.join(os.tmpdir(), `vod-job-${jobId}`);

  try {
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

    const { localPath } = await encodeEditorJsonToMp4({
      spec,
      workDir,
      shouldCancel: () => shouldCancel(jobId),
      onProgress: (p) => {
        updateJob(jobId, { progress: Math.max(2, Math.min(89, p)), phase: "encoding" });
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

    updateJob(jobId, {
      status: "uploading",
      progress: 92,
      phase: "uploading",
      message: "Uploading to storage",
    });

    const fileName = `${jobId}.mp4`;
    const stream = createReadStream(localPath);
    const { key, publicUrl } = await putVodMp4(tenantId, fileName, stream);

    updateJob(jobId, {
      status: "completed",
      progress: 100,
      phase: "completed",
      message: "Done",
      s3Key: key,
      outputUrl: publicUrl || null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "CANCELLED" || shouldCancel(jobId)) {
      updateJob(jobId, {
        status: "cancelled",
        progress: 0,
        phase: "cancelled",
        message: "Cancelled",
      });
    } else {
      updateJob(jobId, {
        status: "failed",
        progress: 0,
        phase: "failed",
        error: msg,
        message: "Failed",
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

  queueMicrotask(() => {
    runVodEncodeJob({ jobId, tenantId, spec }).catch((e) => {
      console.error("[vod] job error", jobId, e);
      updateJob(jobId, {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        phase: "failed",
        message: "Failed",
      });
    });
  });

  return jobId;
}
