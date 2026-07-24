import { Router } from "express";
import { resolveTenant } from "../services/auth.service.js";
import {
  listJobsForTenant,
  getJob,
  updateJob,
  resolveJobVodGuid,
} from "../services/vod-jobs.store.js";
import { startBackgroundVodJob, requestCancelJob } from "../services/vod-encode-runner.service.js";
import { listTenantVodMp4s } from "../services/vod-s3.service.js";
import { backfillWhisperTranscriptByJobId } from "../services/whisper-transcript-backfill.service.js";
import { trySyncInsightVodTranscriptAndNews } from "../services/insight-vod.service.js";
import { getRequestTenantId } from "../utils/tenant-cipher.js";

export const vodRouter = Router();

function getTenantId(req) {
  return getRequestTenantId(req);
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
