/**
 * Builds a mosaic (tiled) JPEG preview from the frames captured in a request and stores it under
 * the previews directory using a filename derived from the `video` argument (sanitized). Because
 * the filename is stable per channel, each new analysis overwrites the previous preview, so there
 * is exactly one image per analyzed channel. A periodic sweep removes files older than the TTL.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

/** Turn the `video` argument into a safe, stable filename base (one per channel). */
export function sanitizeVideoName(videoUrl) {
  const base = String(videoUrl)
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const capped = base.slice(0, 180) || "preview";
  return `${capped}.jpg`;
}

export async function ensurePreviewDir() {
  await fs.mkdir(config.previews.dir, { recursive: true });
}

/**
 * Compose the frames into a grid mosaic and write it atomically to the previews dir.
 * @param {string[]} framePaths
 * @param {string} videoUrl
 * @returns {Promise<string|null>} the stored filename, or null on failure
 */
export async function buildMosaic(framePaths, videoUrl) {
  if (!Array.isArray(framePaths) || framePaths.length === 0) return null;

  const tileW = config.previews.tileWidth;
  const tileH = config.previews.tileHeight;
  const n = framePaths.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);

  try {
    await ensurePreviewDir();

    const tiles = await Promise.all(
      framePaths.map((p) =>
        sharp(p).resize(tileW, tileH, { fit: "cover" }).toBuffer().catch(() => null),
      ),
    );

    const composites = [];
    tiles.forEach((buf, i) => {
      if (!buf) return;
      composites.push({
        input: buf,
        left: (i % cols) * tileW,
        top: Math.floor(i / cols) * tileH,
      });
    });
    if (composites.length === 0) return null;

    const fileName = sanitizeVideoName(videoUrl);
    const outPath = path.join(config.previews.dir, fileName);
    const tmpPath = `${outPath}.${process.pid}.${Date.now()}.tmp`;

    await sharp({
      create: {
        width: cols * tileW,
        height: rows * tileH,
        channels: 3,
        background: { r: 12, g: 12, b: 12 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 80 })
      .toFile(tmpPath);

    await fs.rename(tmpPath, outPath);
    return fileName;
  } catch (e) {
    logger.warn("preview mosaic failed", { error: String(e?.message || e) });
    return null;
  }
}

/** Delete preview files older than the configured TTL. */
export async function sweepPreviews() {
  try {
    const dir = config.previews.dir;
    const entries = await fs.readdir(dir).catch(() => []);
    const now = Date.now();
    let removed = 0;
    for (const name of entries) {
      const p = path.join(dir, name);
      try {
        const st = await fs.stat(p);
        if (now - st.mtimeMs > config.previews.ttlMs) {
          await fs.rm(p, { force: true });
          removed += 1;
        }
      } catch {
        /* ignore individual entry errors */
      }
    }
    if (removed > 0) logger.info("preview sweep removed expired files", { removed });
  } catch (e) {
    logger.warn("preview sweep failed", { error: String(e?.message || e) });
  }
}

/** Build the public URL for a stored preview file. */
export function previewUrl(fileName, req) {
  if (!fileName) return null;
  const routePath = `${config.previews.route}/${encodeURIComponent(fileName)}`;
  // Explicit override (e.g. PREVIEW_PUBLIC_BASE_URL=https://host/insight-cms-live2vod-insight-ad).
  if (config.previews.publicBaseUrl) {
    return `${config.previews.publicBaseUrl}${routePath}`;
  }
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = req.get("host");
  // Honor the reverse-proxy mount path (e.g. "/insight-cms-live2vod-insight-ad") so the public URL
  // includes the prefix under which this service is exposed, not just the bare host.
  const prefix = String(req.headers["x-forwarded-prefix"] || "")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
  return `${proto}://${host}${prefix}${routePath}`;
}

export default { buildMosaic, sweepPreviews, previewUrl, ensurePreviewDir, sanitizeVideoName };
