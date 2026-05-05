/**
 * VOD job registry: PostgreSQL when POSTGRES_HOST + POSTGRES_DB are set, otherwise in-memory.
 * WebSocket fan-out stays in-memory per process.
 */

import { vodEncodeStdout } from "../utils/vod-encode-log.js";
import {
  isVodJobsPostgresEnabled,
  initVodJobsPostgres,
  pgInsertJob,
  pgGetJob,
  pgListJobsForTenant,
  pgCountActiveJobsForTenant,
  pgUpdateJob,
} from "./vod-jobs-pg.repository.js";

/** @typedef {'queued' | 'processing' | 'uploading' | 'completed' | 'cancelled' | 'failed'} VodJobStatus */

/**
 * @typedef {object} VodJob
 * @property {string} id
 * @property {string} tenantId
 * @property {VodJobStatus} status
 * @property {number} progress
 * @property {string} phase
 * @property {string} [message]
 * @property {string} [error]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {string} [clipUrl]
 * @property {string} [s3Key]
 * @property {string[]} [s3Keys]
 * @property {string|null} [outputUrl]
 * @property {(string|null)[]} [outputUrls]
 * @property {string} [transcriptText] plain text from realtime transcribe-only jobs
 * @property {string} [transcriptNewsEn] OpenAI news article (English) after realtime transcribe
 * @property {string} [transcriptNewsEs] OpenAI news article (Spanish)
 * @property {string} [transcriptNewsHe] OpenAI news article (Hebrew)
 * @property {string} [transcriptNewsError] when news drafting failed; transcript may still exist
 * @property {object} [transcriptDiarization] diarized segments + speakerLabels for realtime STT
 * @property {object} [openaiClipUsage] per-step OpenAI token usage + estimated USD for realtime clip STT/news
 * @property {object} [transcriptNewsBundle] rich news fields per locale (editor PATCH + public share page)
 * @property {'vod_encode'|'realtime_transcribe'} [jobKind]
 * @property {string} [editorClipId] client sub-clip id when job was started from the editor row
 */

/** @type {Map<string, VodJob>} */
const jobsById = new Map();

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const subscribersByTenant = new Map();

function usePg() {
  return isVodJobsPostgresEnabled();
}

/** Connect and create `vod_jobs` table when Postgres is configured. */
export async function initVodJobsPersistence() {
  await initVodJobsPostgres();
}

/**
 * @param {string} tenantId
 * @returns {Promise<VodJob[]>}
 */
export async function listJobsForTenant(tenantId) {
  if (usePg()) return /** @type {Promise<VodJob[]>} */ (pgListJobsForTenant(tenantId));
  const list = [];
  for (const job of jobsById.values()) {
    if (job.tenantId === tenantId) list.push(job);
  }
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return list;
}

/**
 * @param {string} tenantId
 * @returns {Promise<number>}
 */
export async function countActiveJobsForTenant(tenantId) {
  if (usePg()) return pgCountActiveJobsForTenant(tenantId);
  let n = 0;
  for (const job of jobsById.values()) {
    if (job.tenantId !== tenantId) continue;
    if (job.status === "queued" || job.status === "processing" || job.status === "uploading") n++;
  }
  return n;
}

/**
 * @param {string} id
 * @returns {Promise<VodJob | undefined>}
 */
export async function getJob(id) {
  if (usePg()) return /** @type {Promise<VodJob | undefined>} */ (pgGetJob(id));
  return jobsById.get(id);
}

/**
 * @param {Omit<VodJob, 'createdAt' | 'updatedAt'> & Partial<Pick<VodJob, 'createdAt'>>} partial
 * @returns {Promise<VodJob>}
 */
export async function createJob(partial) {
  const now = new Date().toISOString();
  /** @type {VodJob} */
  const job = {
    ...partial,
    createdAt: partial.createdAt || now,
    updatedAt: now,
  };
  if (usePg()) await pgInsertJob(job);
  else jobsById.set(job.id, job);
  logVodEncodeJobLine(job, "(created)");
  broadcastTenant(job.tenantId, { type: "job_update", job: serializeJob(job) });
  return job;
}

/**
 * @param {VodJob} job
 * @param {string} [suffix]
 */
function logVodEncodeJobLine(job, suffix) {
  const parts = [
    `job=${job.id}`,
    `tenant=${job.tenantId}`,
    `status=${job.status}`,
    `${job.progress}%`,
    `phase=${job.phase}`,
  ];
  if (job.message) parts.push(`message=${JSON.stringify(job.message)}`);
  if (job.error) parts.push(`error=${JSON.stringify(String(job.error).slice(0, 500))}`);
  if (job.editorClipId) parts.push(`editorClipId=${job.editorClipId}`);
  if (suffix) parts.push(suffix);
  vodEncodeStdout(parts.join(" "));
}

/**
 * @param {string} id
 * @param {Partial<Pick<VodJob, 'status' | 'progress' | 'phase' | 'message' | 'error' | 's3Key' | 's3Keys' | 'outputUrl' | 'outputUrls' | 'transcriptText' | 'transcriptDiarization' | 'transcriptNewsEn' | 'transcriptNewsEs' | 'transcriptNewsHe' | 'transcriptNewsError' | 'openaiClipUsage' | 'transcriptNewsBundle' | 'jobKind'>>} patch
 * @returns {Promise<VodJob | null>}
 */
export async function updateJob(id, patch) {
  if (usePg()) {
    const job = await pgUpdateJob(id, /** @type {Record<string, unknown>} */ (patch));
    if (!job) return null;
    logVodEncodeJobLine(/** @type {VodJob} */ (job));
    broadcastTenant(job.tenantId, { type: "job_update", job: serializeJob(/** @type {VodJob} */ (job)) });
    return /** @type {VodJob} */ (job);
  }
  const job = jobsById.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  logVodEncodeJobLine(job);
  broadcastTenant(job.tenantId, { type: "job_update", job: serializeJob(job) });
  return job;
}

/**
 * @param {VodJob} job
 */
function serializeJob(job) {
  return { ...job };
}

/**
 * @param {string} tenantId
 * @param {object} payload
 */
function broadcastTenant(tenantId, payload) {
  const set = subscribersByTenant.get(tenantId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) {
      try {
        ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * @param {string} tenantId
 * @param {import('ws').WebSocket} ws
 */
export async function subscribeTenant(tenantId, ws) {
  let set = subscribersByTenant.get(tenantId);
  if (!set) {
    set = new Set();
    subscribersByTenant.set(tenantId, set);
  }
  set.add(ws);
  const jobs = await listJobsForTenant(tenantId);
  const activeCount = await countActiveJobsForTenant(tenantId);
  ws.send(
    JSON.stringify({
      type: "snapshot",
      jobs: jobs.map(serializeJob),
      activeCount,
    }),
  );
}

/**
 * @param {string} tenantId
 * @param {import('ws').WebSocket} ws
 */
export function unsubscribeTenant(tenantId, ws) {
  const set = subscribersByTenant.get(tenantId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) subscribersByTenant.delete(tenantId);
}
