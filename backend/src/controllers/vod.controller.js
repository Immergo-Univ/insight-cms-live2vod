import { Router } from "express";
import { resolveTenant } from "../services/auth.service.js";
import {
  listJobsForTenant,
  getJob,
  updateJob,
} from "../services/vod-jobs.store.js";
import { startBackgroundVodJob, requestCancelJob } from "../services/vod-encode-runner.service.js";
import { listTenantVodMp4s } from "../services/vod-s3.service.js";

export const vodRouter = Router();

function getTenantId(req) {
  return (req.query.tenantId || req.headers["x-tenant-id"] || "").trim();
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

    const jobId = startBackgroundVodJob({
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
    res.json({ jobs: listJobsForTenant(tenantId) });
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
    const job = getJob(jobId);
    if (!job || job.tenantId !== tenantId) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return res.json({ ok: true, job });
    }
    requestCancelJob(jobId);
    updateJob(jobId, {
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
