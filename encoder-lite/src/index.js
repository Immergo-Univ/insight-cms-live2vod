import express from "express";
import { config } from "./config.js";
import { runVodEncodeJob, requestCancelJob } from "./services/vod-encode-runner.service.js";
import { collectSystemMetrics } from "./utils/system-metrics.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

function requireEncoderSecret(req, res, next) {
  const expected = config.secret;
  if (!expected) {
    return res.status(503).json({ error: "SECRET is not configured on encoder" });
  }
  const auth = (req.headers.authorization || "").trim();
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const encoderRouter = express.Router();

// Public: no SECRET (load balancers / Docker HEALTHCHECK). Must stay before requireEncoderSecret.
encoderRouter.get("/health", async (_req, res) => {
  try {
    const metrics = await collectSystemMetrics();
    res.json({ ok: true, service: "encoder-lite", ...metrics });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, service: "encoder-lite", error: m });
  }
});

encoderRouter.use(requireEncoderSecret);

encoderRouter.post("/jobs", (req, res) => {
  const jobId = typeof req.body?.jobId === "string" ? req.body.jobId.trim() : "";
  const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";
  const spec = req.body?.spec ?? null;
  const editorClipIdRaw = req.body?.editorClipId;
  const editorClipId =
    typeof editorClipIdRaw === "string" && editorClipIdRaw.trim().length > 0
      ? editorClipIdRaw.trim()
      : undefined;
  if (!jobId || !tenantId || !spec || typeof spec !== "object" || !spec.clipUrl) {
    return res.status(400).json({
      error: "Expected JSON body: { jobId, tenantId, spec } with spec.clipUrl",
    });
  }
  res.status(202).json({ ok: true, jobId });
  queueMicrotask(() => {
    void runVodEncodeJob({ jobId, tenantId, spec, editorClipId }).catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[encoder] unexpected rejection job=${jobId}`, m);
      if (e instanceof Error && e.stack) console.error(e.stack);
    });
  });
});

encoderRouter.post("/jobs/:jobId/cancel", (req, res) => {
  const { jobId } = req.params;
  if (!jobId) return res.status(400).json({ error: "Missing jobId" });
  requestCancelJob(jobId);
  res.json({ ok: true, jobId });
});

app.use("/encoder", encoderRouter);

// Public root alias (same payload as /encoder/health).
app.get("/health", async (_req, res) => {
  try {
    const metrics = await collectSystemMetrics();
    res.json({ ok: true, service: "encoder-lite", ...metrics });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, service: "encoder-lite", error: m });
  }
});

app.listen(config.port, () => {
  console.log(`encoder-lite listening on :${config.port} (routes under /encoder)`);
});
