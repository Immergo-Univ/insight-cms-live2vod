import { Router } from "express";
import { config } from "../config.js";
import { getJob, updateJob } from "../services/vod-jobs.store.js";

/** Fields the encoder service may update on a job (defense in depth). */
const ENCODER_PATCH_KEYS = new Set([
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
]);

export const encoderCallbackRouter = Router();

function readBearerToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return "";
}

function requireEncoderSecret(req, res, next) {
  const expected = config.encoder.secret;
  if (!expected) {
    return res.status(503).json({ error: "SECRET is not configured on backend" });
  }
  if (readBearerToken(req) !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

encoderCallbackRouter.patch("/jobs/:jobId", requireEncoderSecret, (req, res) => {
  const { jobId } = req.params;
  if (!jobId) return res.status(400).json({ error: "Missing jobId" });
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  /** @type {Record<string, unknown>} */
  const patch = {};
  for (const key of ENCODER_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = body[key];
    }
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "No valid fields to patch" });
  }
  updateJob(jobId, patch);
  res.json({ ok: true });
});
