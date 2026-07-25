/**
 * PostgreSQL persistence for VOD / clip jobs via Sequelize (synced models).
 */

import { Op } from "sequelize";
import {
  initSequelizeAndSync,
  isSequelizeReady,
  getVodJobModel,
  closeSequelize,
} from "../db/sequelize.js";

export function isVodJobsPostgresEnabled() {
  return isSequelizeReady();
}

export async function initVodJobsPostgres() {
  await initSequelizeAndSync();
  return null;
}

export async function shutdownVodJobsPostgres() {
  await closeSequelize();
}

/** @param {import("sequelize").Model | null | undefined} instance */
function modelToJob(instance) {
  if (!instance) return undefined;
  const o = instance.get({ plain: true });
  /** @param {unknown} v */
  const str = (v) => (typeof v === "string" ? v : v == null ? undefined : String(v));
  /** @param {unknown} v */
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : undefined);
  /** @param {unknown} v */
  const arr = (v) => (Array.isArray(v) ? v : undefined);
  /** @param {unknown} v */
  const iso = (v) => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string") return v;
    return undefined;
  };

  const editorSpec = obj(o.editorSpec);
  const vodGuidFromCol = str(o.vodGuid);
  const vodGuidFromSpec =
    editorSpec && typeof editorSpec.__vodGuid === "string" ? String(editorSpec.__vodGuid).trim() : "";
  return {
    id: o.id,
    tenantId: o.tenantId,
    status: o.status,
    progress: o.progress,
    phase: o.phase,
    message: str(o.message),
    error: str(o.error),
    createdAt: iso(o.createdAt) || new Date().toISOString(),
    updatedAt: iso(o.updatedAt),
    clipUrl: str(o.clipUrl),
    s3Key: str(o.s3Key),
    s3Keys: arr(o.s3Keys),
    outputUrl: o.outputUrl === null ? null : str(o.outputUrl),
    outputUrls: arr(o.outputUrls),
    transcriptText: str(o.transcriptText),
    transcriptNewsEn: str(o.transcriptNewsEn),
    transcriptNewsEs: str(o.transcriptNewsEs),
    transcriptNewsHe: str(o.transcriptNewsHe),
    transcriptNewsError: str(o.transcriptNewsError),
    transcriptDiarization: obj(o.transcriptDiarization),
    openaiClipUsage: obj(o.openaiClipUsage),
    transcriptNewsBundle: obj(o.transcriptNewsBundle),
    jobKind: str(o.jobKind),
    editorClipId: str(o.editorClipId),
    // Column may be empty on older rows; fall back to editor_spec.__vodGuid.
    vodGuid: vodGuidFromCol || vodGuidFromSpec || undefined,
    editorSpec,
  };
}

/**
 * @param {object} job full row shape (camelCase) matching API VodJob
 */
export async function pgInsertJob(job) {
  const VodJob = getVodJobModel();
  await VodJob.create({
    id: job.id,
    tenantId: job.tenantId,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    message: job.message ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt || job.createdAt,
    clipUrl: job.clipUrl ?? null,
    s3Key: job.s3Key ?? null,
    s3Keys: job.s3Keys ?? null,
    outputUrl: job.outputUrl === undefined ? null : job.outputUrl,
    outputUrls: job.outputUrls ?? null,
    transcriptText: job.transcriptText ?? null,
    transcriptNewsEn: job.transcriptNewsEn ?? null,
    transcriptNewsEs: job.transcriptNewsEs ?? null,
    transcriptNewsHe: job.transcriptNewsHe ?? null,
    transcriptNewsError: job.transcriptNewsError ?? null,
    transcriptDiarization: job.transcriptDiarization ?? null,
    openaiClipUsage: job.openaiClipUsage ?? null,
    transcriptNewsBundle: job.transcriptNewsBundle ?? null,
    jobKind: job.jobKind ?? null,
    editorClipId: job.editorClipId ?? null,
    vodGuid: job.vodGuid ?? null,
    editorSpec: job.editorSpec ?? null,
  });
}

/**
 * @param {string} id
 * @returns {Promise<object | undefined>}
 */
export async function pgGetJob(id) {
  const VodJob = getVodJobModel();
  const row = await VodJob.findByPk(id);
  return modelToJob(row);
}

/**
 * @param {string} tenantId
 * @returns {Promise<object[]>}
 */
export async function pgListJobsForTenant(tenantId) {
  const VodJob = getVodJobModel();
  const rows = await VodJob.findAll({
    where: { tenantId },
    order: [["createdAt", "DESC"]],
  });
  return rows.map((r) => modelToJob(r));
}

/**
 * Find the newest job for a tenant whose Insight VOD guid matches.
 * Prefer column `vod_guid`; fall back to `editor_spec.__vodGuid` for older rows.
 *
 * @param {string} tenantId
 * @param {string} vodGuid
 * @returns {Promise<object | undefined>}
 */
export async function pgFindJobByVodGuid(tenantId, vodGuid) {
  const guid = String(vodGuid || "").trim();
  if (!tenantId || !guid) return undefined;

  const VodJob = getVodJobModel();
  const byColumn = await VodJob.findOne({
    where: { tenantId, vodGuid: guid },
    order: [["createdAt", "DESC"]],
  });
  if (byColumn) return modelToJob(byColumn);

  // Legacy rows: guid only under editor_spec.__vodGuid (JSONB).
  const sequelize = VodJob.sequelize;
  if (!sequelize) return undefined;
  const bySpec = await VodJob.findOne({
    where: {
      tenantId,
      [Op.and]: [sequelize.literal(`editor_spec->>'__vodGuid' = ${sequelize.escape(guid)}`)],
    },
    order: [["createdAt", "DESC"]],
  });
  return modelToJob(bySpec);
}

/**
 * @param {string} tenantId
 */
export async function pgCountActiveJobsForTenant(tenantId) {
  const VodJob = getVodJobModel();
  return VodJob.count({
    where: {
      tenantId,
      status: { [Op.in]: ["queued", "processing", "uploading"] },
    },
  });
}

/** Keys allowed on PATCH (camelCase, match model attributes). */
const PATCH_DB_KEYS = new Set([
  "status",
  "progress",
  "phase",
  "message",
  "error",
  "s3Key",
  "s3Keys",
  "outputUrl",
  "outputUrls",
  "transcriptText",
  "transcriptNewsEn",
  "transcriptNewsEs",
  "transcriptNewsHe",
  "transcriptNewsError",
  "transcriptDiarization",
  "openaiClipUsage",
  "transcriptNewsBundle",
  "jobKind",
  "vodGuid",
  "editorSpec",
]);

/**
 * @param {string} id
 * @param {Record<string, unknown>} patch
 * @returns {Promise<object | null>}
 */
export async function pgUpdateJob(id, patch) {
  const VodJob = getVodJobModel();
  const row = await VodJob.findByPk(id);
  if (!row) return null;

  /** @type {Record<string, unknown>} */
  const updatePayload = {};
  for (const key of PATCH_DB_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      updatePayload[key] = patch[key];
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return modelToJob(row) ?? null;
  }

  await row.update(updatePayload);
  await row.reload();
  return modelToJob(row) ?? null;
}

/**
 * Deep-merge `editor_spec` for a job (internal; used by YouTube syndication status updates).
 *
 * @param {string} jobId
 * @param {(prev: Record<string, unknown> | null) => Record<string, unknown>} fn
 * @returns {Promise<object | null>}
 */
export async function pgMergeEditorSpec(jobId, fn) {
  const VodJob = getVodJobModel();
  const row = await VodJob.findByPk(jobId);
  if (!row) return null;
  const prev =
    row.editorSpec && typeof row.editorSpec === "object" && !Array.isArray(row.editorSpec)
      ? /** @type {Record<string, unknown>} */ (row.get("editorSpec"))
      : {};
  const next = fn(prev);
  await row.update({ editorSpec: next });
  await row.reload();
  return modelToJob(row) ?? null;
}
