/**
 * In-process executor for AI-page runs (Speech-to-text, News article, Subtitles) on existing VODs.
 *
 * Same pipeline as encoder-lite `realtimeTranscribeOnly` jobs (ffmpeg audio extract -> OpenAI STT ->
 * optional OpenAI news), but executed by this backend: the heavy lifting happens at OpenAI, locally
 * only a lightweight mono Opus extraction runs. Job state lives in the regular vod_jobs store,
 * updated directly (no encoder HTTP callback).
 *
 * Runs are tagged `editorSpec.__aiRun.executor = "local"`. A heartbeat keeps `updatedAt` fresh while
 * a run is queued/processing, so a watchdog can fail runs orphaned by a restart (in any replica).
 */

import { randomUUID } from "crypto";
import { createJob, updateJob, listStaleLocalAiRunJobs } from "./vod-jobs.store.js";
import { runRealtimeTranscribeOnlyJob } from "./vod-realtime-transcribe.service.js";
import { reconcileJobCredits } from "./tenant-credits.service.js";
import { getSequelize } from "../db/sequelize.js";
import { config } from "../config.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";

/** Max AI runs executed at the same time by this process. Env: AI_RUNS_LOCAL_CONCURRENCY */
const MAX_CONCURRENT = Math.max(1, Math.min(8, parseInt(process.env.AI_RUNS_LOCAL_CONCURRENCY || "2", 10) || 2));
const HEARTBEAT_MS = 30_000;
/** Runs without updates for this long are considered orphaned (runner died). */
const STALE_AFTER_MS = 10 * 60_000;

/**
 * @typedef {object} LocalAiTask
 * @property {string} jobId
 * @property {string} tenantId
 * @property {object} spec
 * @property {(job: import("./vod-jobs.store.js").VodJob) => Promise<void>} [onCompleted]
 * @property {number} enqueuedAt
 * @property {number} [startedAt]
 * @property {string} baseMessage
 */

/** @type {LocalAiTask[]} */
const queue = [];
/** @type {Map<string, LocalAiTask>} jobs owned by this process (queued or running) */
const ownedTasks = new Map();
/** @type {Set<string>} */
const cancelRequested = new Set();
let runningCount = 0;
let watchdogTimer = null;

/** @param {string} tenantId */
async function tenantAllowsSubtitles(tenantId) {
  const sequelize = getSequelize();
  if (!sequelize) return true;
  const row = await sequelize.models.Tenant.findOne({ where: { tenantId: String(tenantId || "").trim() } });
  if (!row) return true;
  return row.subtitlesEnabled !== false;
}

/**
 * @param {string} jobId
 * @param {string} tenantId
 * @param {object} editorSpec
 * @param {string} clipUrl
 * @param {string} error
 */
async function createFailedJob(jobId, tenantId, editorSpec, clipUrl, error) {
  await createJob({
    id: jobId,
    tenantId,
    status: "failed",
    progress: 0,
    phase: "failed",
    error,
    message: error,
    clipUrl,
    jobKind: "realtime_transcribe",
    editorSpec,
  });
  vodEncodeStdout(`ai-local rejected job=${jobId} tenant=${tenantId} reason=${error}`);
}

/**
 * Queue an AI run to be executed by this backend.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} opts.spec realtimeTranscribeOnly spec (with `__aiRun`)
 * @param {string} [opts.clipUrlPreview]
 * @param {(job: import("./vod-jobs.store.js").VodJob) => Promise<void>} [opts.onCompleted]
 * @returns {Promise<string>} jobId
 */
export async function startLocalAiRunJob({ tenantId, spec, clipUrlPreview, onCompleted }) {
  const jobId = randomUUID();
  const editorSpec = JSON.parse(
    JSON.stringify({ ...spec, __aiRun: { ...(spec?.__aiRun || {}), executor: "local" } }),
  );
  const clipUrl = clipUrlPreview || spec?.clipUrl;

  if (!config.openaiApiKey) {
    await createFailedJob(jobId, tenantId, editorSpec, clipUrl, "OPENAI_API_KEY is not configured on the backend");
    return jobId;
  }
  if (!(await tenantAllowsSubtitles(tenantId))) {
    await createFailedJob(jobId, tenantId, editorSpec, clipUrl, "Subtitles are disabled for this tenant");
    return jobId;
  }

  await createJob({
    id: jobId,
    tenantId,
    status: "queued",
    progress: 0,
    phase: "queued",
    message: "Queued",
    clipUrl,
    jobKind: "realtime_transcribe",
    editorSpec,
  });

  /** @type {LocalAiTask} */
  const task = { jobId, tenantId, spec: editorSpec, onCompleted, enqueuedAt: Date.now(), baseMessage: "Queued" };
  ownedTasks.set(jobId, task);
  queue.push(task);
  vodEncodeStdout(
    `ai-local queued job=${jobId} tenant=${tenantId} service=${editorSpec.__aiRun?.service} ` +
      `langs=[${(editorSpec.__aiRun?.languages || []).join(",")}] source=${clipUrl} ` +
      `queueLength=${queue.length} running=${runningCount}/${MAX_CONCURRENT}`,
  );
  ensureLocalAiRunWatchdog();
  pumpQueue();
  return jobId;
}

/**
 * Cancel a run owned by this process. Returns false when the job is not executed locally here.
 * @param {string} jobId
 */
export function cancelLocalAiRunJob(jobId) {
  if (!ownedTasks.has(jobId)) return false;
  cancelRequested.add(jobId);
  vodEncodeStdout(`ai-local cancel requested job=${jobId}`);
  return true;
}

function pumpQueue() {
  while (runningCount < MAX_CONCURRENT && queue.length > 0) {
    const task = /** @type {LocalAiTask} */ (queue.shift());
    runningCount += 1;
    void runTask(task).finally(() => {
      runningCount -= 1;
      ownedTasks.delete(task.jobId);
      cancelRequested.delete(task.jobId);
      pumpQueue();
    });
  }
}

/** @param {LocalAiTask} task */
async function runTask(task) {
  const { jobId, tenantId, spec, onCompleted } = task;
  task.startedAt = Date.now();
  const shouldCancel = () => cancelRequested.has(jobId);
  const elapsed = () => `${Math.round((Date.now() - (task.startedAt || Date.now())) / 1000)}s`;

  if (shouldCancel()) {
    await updateJob(jobId, { status: "cancelled", progress: 0, phase: "cancelled", message: "Cancelled" });
    vodEncodeStdout(`ai-local cancelled before start job=${jobId}`);
    return;
  }

  vodEncodeStdout(
    `ai-local start job=${jobId} tenant=${tenantId} waitedInQueue=${Math.round((task.startedAt - task.enqueuedAt) / 1000)}s ` +
      `sttModel=${config.openaiSttModel} newsModel=${config.openaiNewsModel} diarization=${spec?.transcribeSpeakerDiarization !== false} ` +
      `news=${spec?.transcribeGenerateNews === true} outputLang=${spec?.clips?.[0]?.subtitles?.whisperOutputLanguage ?? "-"}`,
  );

  /** @param {Record<string, unknown>} patch */
  const reportJob = async (patch) => {
    if (typeof patch.message === "string" && patch.message) task.baseMessage = patch.message;
    if (patch.phase) vodEncodeStdout(`ai-local job=${jobId} phase=${patch.phase} progress=${patch.progress ?? "-"} t=${elapsed()} ${patch.message ?? ""}`);
    const updated = await updateJob(jobId, /** @type {any} */ (patch));
    if (patch.status === "completed" || Object.prototype.hasOwnProperty.call(patch, "openaiClipUsage")) {
      await reconcileJobCredits(jobId).catch((e) => {
        const m = e instanceof Error ? e.message : String(e);
        vodEncodeStdout(`ai-local reconcile credits failed job=${jobId} err=${m}`);
      });
    }
    if (patch.status === "completed" && updated && onCompleted) {
      await onCompleted(updated);
    }
  };

  try {
    await updateJob(jobId, { status: "processing", progress: 2, phase: "starting", message: "Starting AI run" });
    await runRealtimeTranscribeOnlyJob({ jobId, tenantId, spec, shouldCancel, reportJob });
    vodEncodeStdout(`ai-local done job=${jobId} t=${elapsed()}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "CANCELLED" || shouldCancel()) {
      await updateJob(jobId, { status: "cancelled", progress: 0, phase: "cancelled", message: "Cancelled" });
      vodEncodeStdout(`ai-local cancelled job=${jobId} t=${elapsed()}`);
      return;
    }
    const stack = err instanceof Error && err.stack ? ` stack=${err.stack.split("\n").slice(1, 4).join(" | ")}` : "";
    vodEncodeStdout(`ai-local failed job=${jobId} t=${elapsed()} err=${msg.slice(0, 1500)}${stack}`);
    await updateJob(jobId, {
      status: "failed",
      progress: 0,
      phase: "failed",
      error: msg || "Unknown error",
      message: msg ? `Failed: ${msg.slice(0, 200)}` : "Failed",
    });
  }
}

/** Touch every run owned by this process (keeps updatedAt fresh) and fail orphaned runs. */
async function watchdogTick() {
  const now = Date.now();
  let position = 0;
  for (const task of ownedTasks.values()) {
    const running = Boolean(task.startedAt);
    if (!running) position += 1;
    const secs = Math.round((now - (task.startedAt || task.enqueuedAt)) / 1000);
    const message = running
      ? `${task.baseMessage} (${secs}s)`
      : `Queued, waiting for a free AI worker (position ${position}, ${secs}s)`;
    await updateJob(task.jobId, { message }).catch(() => {});
  }

  try {
    const stale = await listStaleLocalAiRunJobs(new Date(now - STALE_AFTER_MS).toISOString());
    for (const job of stale) {
      if (ownedTasks.has(job.id)) continue;
      vodEncodeStdout(`ai-local watchdog failing orphaned job=${job.id} lastUpdate=${job.updatedAt} phase=${job.phase}`);
      await updateJob(job.id, {
        status: "failed",
        progress: 0,
        phase: "failed",
        error: "AI run interrupted (backend restarted or the runner stopped responding)",
        message: "Interrupted, please run it again",
      });
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    vodEncodeStdout(`ai-local watchdog error: ${m}`);
  }
}

/** Start the heartbeat/orphan watchdog once (also called on server startup). */
export function ensureLocalAiRunWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => void watchdogTick(), HEARTBEAT_MS);
  watchdogTimer.unref();
  void watchdogTick();
}
