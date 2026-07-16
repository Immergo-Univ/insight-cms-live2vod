/**
 * insight-ad-recognition — HTTP entrypoint.
 *
 * Express API (CORS enabled) that classifies what a live channel is currently showing (ad /
 * program) with a per-channel rule engine. The CMS posts a trimmed VOD window (`endTime ≈ startTime + 60s`
 * embedded in the URL) plus the channel detection config; this service grabs ONLY the last keyframe
 * and runs an in-container ML sidecar (Tesseract OCR heb/eng/spa + perceptual hashing + NLLB-200
 * translation) to score the configured strategies (logo appearance / disappearance / OCR rules).
 */

import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { detectRouter } from "./routes/detect.route.js";
import { ensureSidecar, isSidecarReady, stopSidecar } from "./services/sidecar.manager.js";
import { ensurePreviewDir, sweepPreviews } from "./services/preview.service.js";

const app = express();

app.set("trust proxy", true);
app.use(cors());
// Config payloads embed sample descriptors (pHash + OCR text) and /sample accepts base64 images.
app.use(express.json({ limit: "12mb" }));

// Static hosting for the frame mosaics (public; no auth). Cached briefly by clients.
app.use(
  config.previews.route,
  express.static(config.previews.dir, { maxAge: "1h", fallthrough: true }),
);

// Lightweight liveness/readiness probe (no auth).
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "insight-ad-recognition",
    sidecarReady: isSidecarReady(),
    uptimeSec: Math.round(process.uptime()),
  });
});

app.use("/", detectRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const server = app.listen(config.port, () => {
  logger.info(`insight-ad-recognition listening on :${config.port}`, {
    authEnabled: Boolean(config.apiSecret),
    maxConcurrentJobs: config.limits.maxConcurrentJobs,
  });

  // Warm up the ML sidecar in the background; the API stays available (degraded) meanwhile.
  ensureSidecar()
    .then((ok) => logger.info("sidecar warmup finished", { ready: ok }))
    .catch((e) => logger.warn("sidecar warmup error", { error: String(e?.message || e) }));

  // Preview lifecycle: ensure the dir exists and sweep expired mosaics periodically.
  ensurePreviewDir().catch(() => {});
  sweepPreviews().catch(() => {});
  setInterval(() => {
    sweepPreviews().catch(() => {});
  }, config.previews.sweepIntervalMs).unref();
});

function shutdown(signal) {
  logger.info(`received ${signal}, shutting down`);
  stopSidecar();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
