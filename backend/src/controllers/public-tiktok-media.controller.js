import { Readable } from "stream";
import { Router } from "express";
import { getJob } from "../services/vod-jobs.store.js";
import { isValidTiktokMediaProxySignature } from "../services/tiktok-media-proxy.service.js";

export const publicTiktokMediaRouter = Router();

async function proxyFromJobOutput(req, res) {
  const tenantId = String(req.params.tenantId || "").trim();
  const jobId = String(req.params.jobId || "").trim();
  const exp = String(req.query.exp || "").trim();
  const sig = String(req.query.sig || "").trim();
  if (!tenantId || !jobId) return res.status(400).type("text/plain").send("Missing tenantId/jobId");
  if (!isValidTiktokMediaProxySignature({ tenantId, jobId, exp, sig })) {
    return res.status(401).type("text/plain").send("Invalid media signature");
  }

  const job = await getJob(jobId);
  if (!job || job.tenantId !== tenantId) return res.status(404).type("text/plain").send("Not found");
  const outputUrl =
    typeof job.outputUrl === "string" && /^https?:\/\//i.test(job.outputUrl.trim())
      ? job.outputUrl.trim()
      : Array.isArray(job.outputUrls) && job.outputUrls.length > 0 && typeof job.outputUrls[0] === "string"
        ? String(job.outputUrls[0]).trim()
        : "";
  if (!outputUrl) return res.status(404).type("text/plain").send("Media not available");

  const upstream = await fetch(outputUrl);
  if (!upstream.ok || !upstream.body) {
    return res.status(502).type("text/plain").send("Upstream media fetch failed");
  }

  const contentType = upstream.headers.get("content-type") || "video/mp4";
  const contentLength = upstream.headers.get("content-length");
  const acceptRanges = upstream.headers.get("accept-ranges");
  res.setHeader("Content-Type", contentType);
  if (contentLength) res.setHeader("Content-Length", contentLength);
  if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
  res.setHeader("Cache-Control", "private, max-age=120");
  if (req.method === "HEAD") return res.status(200).end();
  Readable.fromWeb(upstream.body).pipe(res);
}

publicTiktokMediaRouter.get("/:tenantId/:jobId.mp4", async (req, res) => {
  try {
    await proxyFromJobOutput(req, res);
  } catch (e) {
    res.status(500).type("text/plain").send(e instanceof Error ? e.message : String(e));
  }
});

publicTiktokMediaRouter.head("/:tenantId/:jobId.mp4", async (req, res) => {
  try {
    await proxyFromJobOutput(req, res);
  } catch (e) {
    res.status(500).type("text/plain").send(e instanceof Error ? e.message : String(e));
  }
});
