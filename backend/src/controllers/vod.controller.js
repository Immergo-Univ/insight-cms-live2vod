import { Router } from "express";
import { resolveTenant } from "../services/auth.service.js";
import {
  listJobsForTenant,
  getJob,
  updateJob,
  resolveJobVodGuid,
  findJobByVodGuid,
} from "../services/vod-jobs.store.js";
import { startBackgroundVodJob, requestCancelJob } from "../services/vod-encode-runner.service.js";
import { listTenantVodMp4s } from "../services/vod-s3.service.js";
import { backfillWhisperTranscriptByJobId } from "../services/whisper-transcript-backfill.service.js";
import {
  trySyncInsightVodTranscriptAndNews,
  findInsightVodByGuid,
  updateInsightVodAiByGuid,
  mapInsightNewsToJobFields,
  mapInsightTranscriptToJobFields,
} from "../services/insight-vod.service.js";
import { getRequestTenantId } from "../utils/tenant-cipher.js";

export const vodRouter = Router();

function getTenantId(req) {
  return getRequestTenantId(req);
}

/**
 * Minimal job metadata for the AI VOD page (never the source of truth for news/transcript).
 * @param {import("../services/vod-jobs.store.js").VodJob | null | undefined} job
 */
function jobSummaryForAiPage(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    jobKind: job.jobKind ?? null,
    editorClipId: job.editorClipId ?? null,
    vodGuid: resolveJobVodGuid(job) || null,
    outputUrl: job.outputUrl ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt ?? null,
  };
}

vodRouter.post("/jobs", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenantId (query or x-tenant-id header)" });
    }
    await resolveTenant(tenantId);

    const spec = req.body?.spec ?? req.body;
    if (!spec || typeof spec !== "object" || !spec.clipUrl) {
      return res.status(400).json({ error: "Body must include a VOD spec with clipUrl (send as { spec } or raw object)" });
    }

    const rawClipId = req.body?.editorClipId;
    const editorClipId =
      typeof rawClipId === "string" && rawClipId.trim().length > 0 ? rawClipId.trim() : undefined;

    const jobId = await startBackgroundVodJob({
      tenantId,
      spec,
      clipUrlPreview: spec.clipUrl,
      editorClipId,
    });

    res.status(202).json({ jobId, status: "queued" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

vodRouter.get("/jobs", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenantId" });
    }
    await resolveTenant(tenantId);
    res.json({ jobs: await listJobsForTenant(tenantId) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

/**
 * AI page source of truth: Insight VOD by guid (+ optional linked Live2VOD job summary).
 * GET /api/vod/by-guid/:vodGuid
 */
vodRouter.get("/by-guid/:vodGuid", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenantId (query or x-tenant-id header)" });
    }
    await resolveTenant(tenantId);
    const vodGuid = String(req.params.vodGuid || "").trim();
    if (!vodGuid) {
      return res.status(400).json({ error: "Missing vodGuid" });
    }

    const vod = await findInsightVodByGuid(tenantId, vodGuid);
    if (!vod) {
      return res.status(404).json({ error: "VOD not found" });
    }

    const job = await findJobByVodGuid(tenantId, vodGuid);
    res.json({
      vod,
      job: jobSummaryForAiPage(job),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /not found/i.test(message) ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * Save News / Transcript from AI page: Insight first, then mirror to Postgres job when linked.
 * PATCH /api/vod/by-guid/:vodGuid  body: { news?, transcript? }
 */
vodRouter.patch("/by-guid/:vodGuid", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenantId (query or x-tenant-id header)" });
    }
    await resolveTenant(tenantId);
    const vodGuid = String(req.params.vodGuid || "").trim();
    if (!vodGuid) {
      return res.status(400).json({ error: "Missing vodGuid" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const hasNews = Object.prototype.hasOwnProperty.call(body, "news");
    const hasTranscript = Object.prototype.hasOwnProperty.call(body, "transcript");
    if (!hasNews && !hasTranscript) {
      return res.status(400).json({ error: "Body must include news and/or transcript" });
    }
    if (hasNews && !Array.isArray(body.news)) {
      return res.status(400).json({ error: "news must be an array" });
    }
    if (hasTranscript && !Array.isArray(body.transcript)) {
      return res.status(400).json({ error: "transcript must be an array" });
    }

    /** @type {Record<string, unknown>} */
    const updateOpts = { tenantId, vodGuid };
    if (hasNews) updateOpts.news = body.news;
    if (hasTranscript) updateOpts.transcript = body.transcript;

    const vod = await updateInsightVodAiByGuid(updateOpts);

    const job = await findJobByVodGuid(tenantId, vodGuid);
    /** @type {import("../services/vod-jobs.store.js").VodJob | null | undefined} */
    let refreshedJob = job;
    let postgresSyncError = null;

    if (job?.id) {
      try {
        /** @type {Record<string, unknown>} */
        const jobPatch = {};
        if (hasNews) {
          Object.assign(jobPatch, mapInsightNewsToJobFields(vod.news));
        }
        if (hasTranscript) {
          Object.assign(jobPatch, mapInsightTranscriptToJobFields(vod.transcript));
        }
        if (Object.keys(jobPatch).length > 0) {
          refreshedJob = await updateJob(job.id, jobPatch);
        }
      } catch (pgErr) {
        postgresSyncError = pgErr instanceof Error ? pgErr.message : String(pgErr);
        console.error(
          `[vod] Insight saved but Postgres mirror failed guid=${vodGuid} job=${job.id}: ${postgresSyncError}`,
        );
        return res.status(502).json({
          error: "Insight updated but Live2VOD job sync failed",
          detail: postgresSyncError,
          vod,
          job: jobSummaryForAiPage(job),
        });
      }
    }

    res.json({
      ok: true,
      vod,
      job: jobSummaryForAiPage(refreshedJob),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /not found/i.test(message) ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * Rebuild dash-prefixed transcript lines from diarized segments + speaker label map.
 * @param {object} di
 * @returns {string}
 */
function rebuildTranscriptTextFromDiarization(di) {
  if (!di || !Array.isArray(di.segments)) return "";
  const labels = di.speakerLabels && typeof di.speakerLabels === "object" && !Array.isArray(di.speakerLabels) ? di.speakerLabels : {};
  /** @param {string} id */
  const defaultName = (id) => {
    const x = String(id || "").trim();
    if (/^[A-Z]$/.test(x)) return `Speaker ${x}`;
    return x || "Speaker";
  };
  return di.segments
    .map((/** @type {{ speaker?: string, text?: string }} */ s) => {
      const id = String(s.speaker || "").trim() || "A";
      const custom = typeof labels[id] === "string" ? labels[id].trim() : "";
      const name = custom || defaultName(id);
      const line = String(s.text || "")
        .trim()
        .replace(/\s*\n\s*/g, " ");
      return `- ${name}: ${line}`;
    })
    .join("\n\n");
}

vodRouter.post("/jobs/:jobId/backfill-transcript", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenantId (query or x-tenant-id header)" });
    }
    await resolveTenant(tenantId);
    const { jobId } = req.params;
    const job = await getJob(jobId);
    if (!job || job.tenantId !== tenantId) {
      return res.status(404).json({ error: "Job not found" });
    }
    const result = await backfillWhisperTranscriptByJobId(jobId);
    if (!result.ok || !result.job?.transcriptText?.trim()) {
      return res.status(404).json({
        error: "No transcript artifacts found for this job",
        reason: result.reason,
        detail: result.detail,
        urls: result.urls,
      });
    }
    res.json({ ok: true, reason: result.reason, job: result.job });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

vodRouter.patch("/jobs/:jobId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenantId (query or x-tenant-id header)" });
    }
    await resolveTenant(tenantId);
    const { jobId } = req.params;
    const job = await getJob(jobId);
    if (!job || job.tenantId !== tenantId) {
      return res.status(404).json({ error: "Job not found" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const incomingLabels = body.transcriptSpeakerLabels;
    const hasLabels =
      incomingLabels && typeof incomingLabels === "object" && !Array.isArray(incomingLabels);
    const hasNewsBundle =
      body.transcriptNewsBundle !== undefined &&
      body.transcriptNewsBundle !== null &&
      typeof body.transcriptNewsBundle === "object" &&
      !Array.isArray(body.transcriptNewsBundle);

    if (!hasLabels && !hasNewsBundle) {
      return res.status(400).json({ error: "Body must include transcriptSpeakerLabels and/or transcriptNewsBundle" });
    }

    /** @type {Record<string, unknown>} */
    const patch = {};

    if (hasLabels) {
      const base = job.transcriptDiarization;
      if (!base || typeof base !== "object" || !Array.isArray(base.segments) || base.segments.length === 0) {
        return res.status(400).json({ error: "This job has no diarized transcript to edit" });
      }
      const prevLabels =
        base.speakerLabels && typeof base.speakerLabels === "object" && !Array.isArray(base.speakerLabels)
          ? base.speakerLabels
          : {};
      const di = {
        ...base,
        segments: base.segments,
        speakerLabels: { ...prevLabels, ...incomingLabels },
      };
      patch.transcriptDiarization = di;
      patch.transcriptText = rebuildTranscriptTextFromDiarization(di);
    }

    if (hasNewsBundle) {
      patch.transcriptNewsBundle = body.transcriptNewsBundle;
    }

    await updateJob(jobId, patch);
    const refreshed = await getJob(jobId);
    if (resolveJobVodGuid(refreshed)) {
      void trySyncInsightVodTranscriptAndNews(refreshed);
    }
    res.json({ ok: true, job: refreshed });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

vodRouter.post("/jobs/:jobId/cancel", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenantId" });
    }
    await resolveTenant(tenantId);
    const { jobId } = req.params;
    const job = await getJob(jobId);
    if (!job || job.tenantId !== tenantId) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return res.json({ ok: true, job });
    }
    requestCancelJob(jobId);
    await updateJob(jobId, {
      message: "Cancelling…",
      phase: "cancelling",
    });
    res.json({ ok: true, jobId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

vodRouter.get("/outputs", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenantId" });
    }
    await resolveTenant(tenantId);
    const objects = await listTenantVodMp4s(tenantId);
    res.json({ objects });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});
