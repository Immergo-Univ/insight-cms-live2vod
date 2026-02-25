import { Router } from "express";
import { queryAdsByM3u8Url, queryAdsForTimeline } from "../services/ads-precalc.service.js";

export const adsRouter = Router();

adsRouter.get("/precalculated", (req, res) => {
  try {
    const { hlsStream, startTime, endTime } = req.query;

    if (!hlsStream || !startTime || !endTime) {
      return res.status(400).json({ error: "Missing required query params: hlsStream, startTime, endTime" });
    }

    const result = queryAdsForTimeline(
      hlsStream,
      parseInt(startTime, 10),
      parseInt(endTime, 10),
    );

    console.log(
      `[ads] Timeline query: ${result.ads.length} pre-calculated ad(s) for ${hlsStream}`,
    );

    res.json(result);
  } catch (error) {
    console.error("[ads] Timeline query failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

adsRouter.post("/detect", (req, res) => {
  try {
    const { m3u8Url } = req.body;

    if (!m3u8Url) {
      return res.status(400).json({ error: "Missing required field: m3u8Url" });
    }

    const result = queryAdsByM3u8Url(m3u8Url);

    if (!result) {
      return res.json({ m3u8: m3u8Url, totalDurationSec: 0, ads: [] });
    }

    const range = result._processedRange;
    console.log(
      `[ads] Pre-calc query for: ${m3u8Url} — ${result.ads.length} ad(s)` +
      (range ? ` (processed: ${range.earliest} → ${range.latest})` : "")
    );

    res.json(result);
  } catch (error) {
    console.error("[ads] Lookup failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});
