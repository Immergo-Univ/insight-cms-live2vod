import { Router } from "express";
import { config } from "../config.js";
import { getJob, updateJob } from "../services/vod-jobs.store.js";
import { trySyncInsightVodWhisperSubtitleLabels, trySyncInsightVodTranscriptAndNews } from "../services/insight-vod.service.js";
import { tryBackfillWhisperTranscriptForJob } from "../services/whisper-transcript-backfill.service.js";
import { tryYoutubeSyndicationAfterJobCompleted } from "../services/youtube-syndication-runner.service.js";
import { tryTwitterSyndicationAfterJobCompleted } from "../services/twitter-syndication-runner.service.js";
import { tryFacebookSyndicationAfterJobCompleted } from "../services/facebook-syndication-runner.service.js";
import { tryInstagramSyndicationAfterJobCompleted } from "../services/instagram-syndication-runner.service.js";
import { tryTiktokSyndicationAfterJobCompleted } from "../services/tiktok-syndication-runner.service.js";
import { resolveJobMasterOutputUrl } from "../services/encoder-output-url.service.js";

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

encoderCallbackRouter.patch("/jobs/:jobId", requireEncoderSecret, async (req, res) => {
  const { jobId } = req.params;
  if (!jobId) return res.status(400).json({ error: "Missing jobId" });
  const job = await getJob(jobId);
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
  if (patch.status === "completed") {
    const masterUrl = await resolveJobMasterOutputUrl(job);
    if (masterUrl) {
      patch.outputUrl = masterUrl;
      if (!Array.isArray(patch.outputUrls) || patch.outputUrls.length === 0) {
        patch.outputUrls = [masterUrl];
      }
    }
  }
  const updatedJob = await updateJob(jobId, patch);
  if (updatedJob) {
    if (patch.transcriptText || patch.status === "completed") {
      void trySyncInsightVodWhisperSubtitleLabels(updatedJob);
    }
    // Wait for the immergo encode to finish, then push transcript/news to insight-api.
    // Mid-encode STT patches are stored on the job; Insight is updated once on completed.
    if (patch.status === "completed") {
      void tryBackfillWhisperTranscriptForJob(updatedJob)
        .then(async () => {
          const refreshed = await getJob(jobId);
          if (refreshed) void trySyncInsightVodTranscriptAndNews(refreshed);
        })
        .catch((e) => {
          const m = e instanceof Error ? e.message : String(e);
          console.error(`[encoder-callback] whisper transcript backfill job=${jobId}`, m);
          void trySyncInsightVodTranscriptAndNews(updatedJob);
        });
    }
  }
  if (patch.status === "completed") {
    void tryYoutubeSyndicationAfterJobCompleted(jobId).catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[encoder-callback] youtube syndication job=${jobId}`, m);
    });
    void tryTwitterSyndicationAfterJobCompleted(jobId).catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[encoder-callback] twitter syndication job=${jobId}`, m);
    });
    void tryFacebookSyndicationAfterJobCompleted(jobId).catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[encoder-callback] facebook syndication job=${jobId}`, m);
    });
    void tryInstagramSyndicationAfterJobCompleted(jobId).catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[encoder-callback] instagram syndication job=${jobId}`, m);
    });
    void tryTiktokSyndicationAfterJobCompleted(jobId).catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[encoder-callback] tiktok syndication job=${jobId}`, m);
    });
  }
  res.json({ ok: true });
});
