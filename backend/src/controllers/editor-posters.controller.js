import { Router } from "express";
import multer from "multer";
import {
  deleteEditorPoster,
  isValidEditorPosterId,
  loadEditorPosterBuffer,
  saveEditorPosterFromBuffer,
} from "../services/editor-posters.service.js";
import { saveEditorWidgetImageForEncode } from "../services/editor-widget-images.service.js";

export const editorPostersRouter = Router();

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 24 },
  fileFilter: (_req, file, cb) => {
    const okMime = /^image\/(png|jpeg)$/i.test(file.mimetype || "");
    const okName = /\.(png|jpe?g)$/i.test(file.originalname || "");
    if (okMime || okName) cb(null, true);
    else cb(new Error("Only PNG or JPEG images are allowed"));
  },
});

function postersUploadMiddleware(req, res, next) {
  const mw = uploadMemory;
  mw.array("posters", 24)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || String(err) });
    next();
  });
}

function widgetImagesUploadMiddleware(req, res, next) {
  const mw = uploadMemory;
  mw.array("widgetImages", 8)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || String(err) });
    next();
  });
}

/**
 * Multipart ingest for editor clip-widget images (storage + public URL for encoder spec). VOD widget rasterization is not done here.
 */
editorPostersRouter.post("/:channelId/editor/widget-images", widgetImagesUploadMiddleware, async (req, res) => {
  try {
    const files = req.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Missing files field "widgetImages" (multipart)' });
    }
    const channelId = req.params.channelId;
    /** @type {Array<{ id: string, originalName: string, storedRelative: string, mime: string, src: string, previewUrl: string }>} */
    const images = [];
    for (const f of files) {
      const buffer = f.buffer;
      if (!buffer) {
        return res.status(400).json({ error: "Invalid upload (expected memory buffer)" });
      }
      const row = await saveEditorWidgetImageForEncode(channelId, buffer, f.originalname, f.mimetype);
      images.push(row);
    }
    res.json({ images });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

editorPostersRouter.post("/:channelId/editor/posters", postersUploadMiddleware, async (req, res) => {
  try {
    const files = req.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Missing files field "posters" (multipart)' });
    }
    const channelId = req.params.channelId;
    const base = `/api/channels/${encodeURIComponent(channelId)}/editor/posters`;
    /** @type {Array<{ id: string, originalName: string, storedRelative: string, mime: string, previewUrl: string }>} */
    const posters = [];
    for (const f of files) {
      const buffer = f.buffer;
      if (!buffer) {
        return res.status(400).json({ error: "Invalid upload (expected memory buffer)" });
      }
      const meta = await saveEditorPosterFromBuffer(buffer, f.originalname, f.mimetype);
      posters.push({
        ...meta,
        previewUrl: `${base}/${encodeURIComponent(meta.id)}/file`,
      });
    }
    res.json({ posters });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

editorPostersRouter.get("/:channelId/editor/posters/:posterId/file", async (req, res) => {
  try {
    const posterId = req.params.posterId;
    if (!isValidEditorPosterId(posterId)) return res.status(400).end();
    const loaded = await loadEditorPosterBuffer(posterId);
    if (!loaded) return res.status(404).end();
    res.setHeader("Content-Type", loaded.mime || "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(loaded.buffer);
  } catch (e) {
    if (!res.headersSent) res.status(500).end();
  }
});

editorPostersRouter.delete("/:channelId/editor/posters/:posterId", async (req, res) => {
  try {
    const posterId = req.params.posterId;
    if (!isValidEditorPosterId(posterId)) {
      return res.status(400).json({ error: "Invalid poster id" });
    }
    const removed = await deleteEditorPoster(posterId);
    if (!removed) return res.status(404).json({ error: "Poster not found" });
    res.json({ ok: true, removedId: posterId });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
