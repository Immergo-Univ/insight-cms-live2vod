/**
 * In-memory VOD job registry + WebSocket fan-out per tenant.
 */

import { vodEncodeStdout } from "../utils/vod-encode-log.js";

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
 * @property {'vod_encode'|'realtime_transcribe'} [jobKind]
 * @property {string} [editorClipId] client sub-clip id when job was started from the editor row
 */

/** @type {Map<string, VodJob>} */
const jobsById = new Map();

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const subscribersByTenant = new Map();

/**
 * @param {string} tenantId
 * @returns {VodJob[]}
 */
export function listJobsForTenant(tenantId) {
  const list = [];
  for (const job of jobsById.values()) {
    if (job.tenantId === tenantId) list.push(job);
  }
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return list;
}

/**
 * @param {string} tenantId
 */
export function countActiveJobsForTenant(tenantId) {
  let n = 0;
  for (const job of jobsById.values()) {
    if (job.tenantId !== tenantId) continue;
    if (job.status === "queued" || job.status === "processing" || job.status === "uploading") n++;
  }
  return n;
}

/**
 * @param {string} id
 * @returns {VodJob | undefined}
 */
export function getJob(id) {
  return jobsById.get(id);
}

/**
 * @param {Omit<VodJob, 'createdAt' | 'updatedAt'> & Partial<Pick<VodJob, 'createdAt'>>} partial
 */
export function createJob(partial) {
  const now = new Date().toISOString();
  /** @type {VodJob} */
  const job = {
    ...partial,
    createdAt: partial.createdAt || now,
    updatedAt: now,
  };
  jobsById.set(job.id, job);
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
 * @param {Partial<Pick<VodJob, 'status' | 'progress' | 'phase' | 'message' | 'error' | 's3Key' | 's3Keys' | 'outputUrl' | 'outputUrls' | 'transcriptText' | 'transcriptNewsEn' | 'transcriptNewsEs' | 'transcriptNewsHe' | 'transcriptNewsError' | 'jobKind'>>} patch
 */
export function updateJob(id, patch) {
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
export function subscribeTenant(tenantId, ws) {
  let set = subscribersByTenant.get(tenantId);
  if (!set) {
    set = new Set();
    subscribersByTenant.set(tenantId, set);
  }
  set.add(ws);
  ws.send(
    JSON.stringify({
      type: "snapshot",
      jobs: listJobsForTenant(tenantId).map(serializeJob),
      activeCount: countActiveJobsForTenant(tenantId),
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
