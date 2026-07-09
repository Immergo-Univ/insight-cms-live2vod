/**
 * GET /detect?video=<mp4|m3u8 url>[&verbose=1]
 *
 * Returns the compact verdict by default:
 *   { detection: "ad"|"program"|"silence", score, timestamp }
 *
 * With `verbose=1` (or `full=1`) the full profile JSON + pipeline metadata are included.
 */

import { Router } from "express";
import { config } from "../config.js";
import { analyzeVideo } from "../services/profile.service.js";
import { previewUrl } from "../services/preview.service.js";
import { requireSecret } from "../middleware/auth.js";
import { Semaphore } from "../utils/semaphore.js";
import { createWorkDir, removeWorkDir } from "../utils/tmp.js";
import { logger } from "../utils/logger.js";

export const detectRouter = Router();

const jobs = new Semaphore(config.limits.maxConcurrentJobs);

function isValidVideoArg(v) {
  if (typeof v !== "string" || v.length === 0) return false;
  return /^https?:\/\//i.test(v) || v.startsWith("/") || /\.(mp4|m3u8)$/i.test(v);
}

/**
 * Classify an analysis failure so we don't scream ERROR for transient upstream hiccups (Akamai
 * archive origins returning HTTP 400 while segments are still packaging, `fillgaps` proxies
 * returning 5xx, ffmpeg getting "Server returned 5XX" while pulling media segments, etc.).
 *
 * These aren't bugs — they resolve on the next probe (or via the CMS scheduler's retry with an
 * extended window) — so surface them as WARN. Real detector faults still log as ERROR.
 * @param {string} msg
 */
function isUpstreamFetchError(msg) {
  if (!msg) return false;
  return (
    /HTTP\s+(4\d\d|5\d\d)\s+fetching/i.test(msg) ||
    /Server returned\s+\dXX/i.test(msg) ||
    /Master playlist has no renditions/i.test(msg) ||
    /Media playlist has no segments/i.test(msg) ||
    /ffmpeg produced no frames/i.test(msg)
  );
}

detectRouter.get("/detect", requireSecret, async (req, res) => {
  const video = req.query.video;
  const verbose = req.query.verbose === "1" || req.query.full === "1";

  if (!isValidVideoArg(video)) {
    return res.status(400).json({ error: "Missing or invalid required query param: video" });
  }

  const startedAt = Date.now();
  const workDir = await createWorkDir();
  try {
    const result = await jobs.run(() => analyzeVideo(String(video), workDir));

    const payload = {
      // The selected class is the final verdict. `selected` restates `detection` explicitly so
      // consumers can unambiguously read which attribute was chosen.
      detection: result.detection,
      selected: result.detection,
      score: result.score,
      confidence: result.confidence,
      // All candidate detection classes with their scores (winner included).
      scores: result.scores ?? {},
      timestamp: result.timestamp,
      took: Date.now() - startedAt,
      // Raw extracted content.
      transcript: result.transcript ?? "",
      ocr_text: result.ocr_text ?? "",
      // Mosaic preview of the captured frames (one file per channel, expires after TTL).
      url_image: previewUrl(result.previewFile, req),
      // Full internal profile as described in docs/insight-ad-recognition.md.
      profile: result.profile,
    };

    if (verbose) {
      return res.json({ ...payload, meta: result.meta });
    }
    return res.json(payload);
  } catch (e) {
    const msg = String(e?.message || e);
    const meta = { error: msg, video: String(video).slice(0, 120) };
    if (isUpstreamFetchError(msg)) {
      logger.warn("detect failed (upstream)", meta);
    } else {
      logger.error("detect failed", meta);
    }
    return res.status(502).json({ error: `Analysis failed: ${e?.message || String(e)}` });
  } finally {
    await removeWorkDir(workDir);
  }
});

export default detectRouter;
