/**
 * POST /detect  { video, config }
 *   -> { detection, score, threshold, scores, strategies, ocrText, ocrTextEn, elapsedMs,
 *        strategyResults, url_image, took }
 *
 * POST /sample  { imageUrl | imageBase64 }
 *   -> { phash, ocrText, ocrTextEn }   (template analysis performed when the admin uploads a sample)
 *
 * The CMS drives the pulse: it posts a trimmed VOD window (startTime/endTime embedded in `video`)
 * plus the per-channel detection config. This service only ever inspects the LAST frame.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { config } from "../config.js";
import { analyzeVideo } from "../services/analyze.service.js";
import { analyzeSample } from "../services/sidecar.client.js";
import { previewUrl } from "../services/preview.service.js";
import { requireSecret } from "../middleware/auth.js";
import { Semaphore } from "../utils/semaphore.js";
import { createWorkDir, removeWorkDir } from "../utils/tmp.js";
import { logger } from "../utils/logger.js";

export const detectRouter = Router();

const jobs = new Semaphore(config.limits.maxConcurrentJobs);

function isValidVideoArg(v) {
  if (typeof v !== "string" || v.length === 0) return false;
  return /^https?:\/\//i.test(v) || v.startsWith("/") || /\.(mp4|m3u8)/i.test(v);
}

/**
 * Transient upstream hiccups (archive origin still packaging, fillgaps proxy 5xx, ffmpeg pulling
 * media segments) are not detector bugs — surface them as WARN so the logs stay readable.
 */
function isUpstreamFetchError(msg) {
  if (!msg) return false;
  return (
    /HTTP\s+(4\d\d|5\d\d)\s+fetching/i.test(msg) ||
    /Server returned\s+\dXX/i.test(msg) ||
    /Master playlist has no renditions/i.test(msg) ||
    /Media playlist has no segments/i.test(msg) ||
    /ffmpeg produced no frame/i.test(msg)
  );
}

detectRouter.post("/detect", requireSecret, async (req, res) => {
  const body = req.body || {};
  const video = body.video;
  const verbose = req.query.verbose === "1" || body.verbose === true;

  if (!isValidVideoArg(video)) {
    return res.status(400).json({ error: "Missing or invalid required field: video" });
  }

  const startedAt = Date.now();
  const workDir = await createWorkDir();
  try {
    const result = await jobs.run(() => analyzeVideo(String(video), workDir, body.config));

    const payload = {
      detection: result.detection,
      selected: result.detection,
      score: result.score,
      threshold: result.threshold,
      scores: result.scores ?? {},
      strategies: result.strategies ?? {},
      strategyResults: result.strategyResults ?? {},
      ocrText: result.ocrText ?? "",
      ocrTextEn: result.ocrTextEn ?? "",
      elapsedMs: result.elapsedMs,
      timestamp: result.timestamp,
      took: Date.now() - startedAt,
      url_image: previewUrl(result.previewFile, req),
    };

    if (verbose) return res.json({ ...payload, meta: result.meta });
    return res.json(payload);
  } catch (e) {
    const msg = String(e?.message || e);
    const meta = { error: msg, video: String(video).slice(0, 120) };
    if (isUpstreamFetchError(msg)) logger.warn("detect failed (upstream)", meta);
    else logger.error("detect failed", meta);
    return res.status(502).json({ error: `Analysis failed: ${e?.message || String(e)}` });
  } finally {
    await removeWorkDir(workDir);
  }
});

/**
 * Analyze an uploaded template sample so the admin UI can persist its perceptual hash + OCR text
 * inside the channel config. Accepts a public URL or a base64 payload.
 */
detectRouter.post("/sample", requireSecret, async (req, res) => {
  const body = req.body || {};
  const workDir = await createWorkDir();
  try {
    const imgPath = path.join(workDir, "sample.img");
    if (typeof body.imageUrl === "string" && /^https?:\/\//i.test(body.imageUrl)) {
      const buf = await fetchImage(body.imageUrl);
      await fs.writeFile(imgPath, buf);
    } else if (typeof body.imageBase64 === "string" && body.imageBase64.length) {
      const b64 = body.imageBase64.replace(/^data:[^;]+;base64,/, "");
      await fs.writeFile(imgPath, Buffer.from(b64, "base64"));
    } else {
      return res.status(400).json({ error: "Provide imageUrl or imageBase64" });
    }

    const out = await jobs.run(() => analyzeSample(imgPath));
    if (!out) return res.status(502).json({ error: "Sample analysis failed (sidecar unavailable)" });
    return res.json({
      phash: out.phash ?? "",
      ocrText: out.ocrText ?? "",
      ocrTextEn: out.ocrTextEn ?? "",
    });
  } catch (e) {
    logger.warn("sample failed", { error: String(e?.message || e) });
    return res.status(502).json({ error: `Sample analysis failed: ${e?.message || String(e)}` });
  } finally {
    await removeWorkDir(workDir);
  }
});

async function fetchImage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.limits.sampleFetchTimeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching sample`);
    return Buffer.from(await r.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

export default detectRouter;
