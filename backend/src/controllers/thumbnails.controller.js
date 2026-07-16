/**
 * Proxy editor thumbnails through Live2VOD so master playlists are resolved to the
 * lowest-resolution media playlist before calling the external genThumbTime service.
 */

import { Router } from "express";
import { config } from "../config.js";
import { resolveLowestRenditionUrl } from "../services/m3u8.service.js";

export const thumbnailsRouter = Router();

/**
 * GET /api/thumbnails?url=&time=&channelId=
 * Resolves master → lowest rendition, then proxies genThumbTime image bytes.
 */
thumbnailsRouter.get("/", async (req, res) => {
  try {
    const clipUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
    const time = req.query.time != null ? String(req.query.time) : "0";
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId.trim() : "";
    const base = (config.thumbnailApiBase || "").trim();

    if (!clipUrl) {
      return res.status(400).json({ error: "Missing required query parameter: url" });
    }
    if (!base) {
      return res.status(500).json({ error: "THUMBNAIL_API_BASE is not configured" });
    }

    const mediaUrl = await resolveLowestRenditionUrl(clipUrl);
    const params = new URLSearchParams();
    params.set("url", mediaUrl);
    params.set("time", time);
    if (channelId) params.set("channelId", channelId);

    const upstream = `${base}?${params.toString()}`;
    const upstreamRes = await fetch(upstream, { signal: AbortSignal.timeout(45_000) });
    if (!upstreamRes.ok) {
      const body = await upstreamRes.text().catch(() => "");
      return res
        .status(upstreamRes.status)
        .type("text/plain")
        .send(body || `Thumbnail upstream HTTP ${upstreamRes.status}`);
    }

    const contentType = upstreamRes.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.setHeader("Cache-Control", "public, max-age=60");
    res.type(contentType).send(buf);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});
