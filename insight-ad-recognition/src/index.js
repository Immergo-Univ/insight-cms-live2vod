/**
 * insight-ad-recognition — HTTP entrypoint.
 *
 * Express API (CORS enabled) that classifies what a live channel is currently showing
 * (ad / program / silence) by profiling a short window of the stream with ffmpeg and an
 * in-container ML sidecar hosting a CLAP zero-shot audio classifier. Whisper.cpp is kept for
 * observability only — the AD/program verdict is derived purely from the audio channel.
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
app.use(express.json({ limit: "256kb" }));

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
