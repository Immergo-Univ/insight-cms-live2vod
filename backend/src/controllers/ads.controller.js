import { Router } from "express";
import { detectAds } from "../services/ads.service.js";

export const adsRouter = Router();

adsRouter.post("/detect", (req, res) => {
  try {
    const { m3u8Url, corner } = req.body;

    if (!m3u8Url) {
      return res.status(400).json({ error: "Missing required field: m3u8Url" });
    }

    const validCorners = ["tl", "tr", "bl", "br"];
    if (corner && !validCorners.includes(corner)) {
      return res.status(400).json({ error: `Invalid corner: ${corner}. Must be one of: ${validCorners.join(", ")}` });
    }

    console.log(`[ads] Starting detection for: ${m3u8Url} (corner: ${corner || "br"})`);
    const startTime = Date.now();

    const result = detectAds({ m3u8Url, corner });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ads] Detection completed in ${elapsed}s — found ${result.ads?.length ?? 0} ad(s)`);

    res.json(result);
  } catch (error) {
    const stderr = error.stderr?.toString() || "";
    const message = stderr || error.message || "Ads detection failed";
    console.error("[ads] Detection failed:", message);
    res.status(500).json({ error: message });
  }
});
