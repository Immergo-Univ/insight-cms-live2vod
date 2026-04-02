import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import {
  addChannelLogoEntries,
  readChannelSettings,
  removeChannelLogo,
  logoFileAbsolutePath,
  safeChannelSegment,
} from "../services/channel-settings.service.js";
import { resolveLogoDetectorDebugImagePath } from "../services/logo-pipeline.service.js";
import { clearChannelAdsSnapshot } from "../services/channel-ads-disk.service.js";
import {
  deleteChannelAdsBackupObject,
  deleteLogoObject,
  isS3LogosEnabled,
  putLogoObject,
} from "../services/s3-logos.service.js";

export const channelSettingsRouter = Router();

const diskStorage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    try {
      const dir = path.join(config.channelSettings.logosDir, safeChannelSegment(req.params.channelId));
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ext === ".png" || ext === ".jpg" || ext === ".jpeg" ? ext : ".png";
    cb(null, `${randomUUID()}${safeExt}`);
  },
});

const uploadDisk = multer({
  storage: diskStorage,
  limits: { fileSize: 8 * 1024 * 1024, files: 24 },
  fileFilter: (_req, file, cb) => {
    const okMime = /^image\/(png|jpeg)$/i.test(file.mimetype || "");
    const okName = /\.(png|jpe?g)$/i.test(file.originalname || "");
    if (okMime || okName) cb(null, true);
    else cb(new Error("Only PNG or JPEG images are allowed"));
  },
});

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

function logosUploadMiddleware(req, res, next) {
  const mw = isS3LogosEnabled() ? uploadMemory : uploadDisk;
  mw.array("logos", 24)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || String(err) });
    next();
  });
}

/** Last logo-detector debug JPEG for this channel (overwritten each probe; requires live/archive probe activity). */
channelSettingsRouter.get("/:channelId/logo-detector-debug", async (req, res) => {
  const abs = path.resolve(resolveLogoDetectorDebugImagePath(req.params.channelId));
  try {
    await fs.access(abs);
  } catch {
    return res.status(404).json({
      error: "Debug frame not found yet for this channel (wait for the next logo-detector run).",
    });
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(abs, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

channelSettingsRouter.get("/:channelId/settings", async (req, res) => {
  try {
    const doc = await readChannelSettings(req.params.channelId);
    const base = `/api/channels/${encodeURIComponent(req.params.channelId)}/settings/logos`;
    const logos = doc.logos.map((e) => ({
      ...e,
      previewUrl: `${base}/${encodeURIComponent(e.id)}/file`,
    }));
    res.json({ channelId: doc.channelId, logos, updatedAt: doc.updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

channelSettingsRouter.post("/:channelId/settings/logos", logosUploadMiddleware, async (req, res) => {
  try {
    const files = req.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Missing files field \"logos\" (multipart)" });
    }
    const channelId = req.params.channelId;
    const seg = safeChannelSegment(channelId);
    /** @type {{ originalName: string, storedRelative: string, mime: string }[]} */
    const metas = [];

    if (isS3LogosEnabled()) {
      /** @type {string[]} */
      const uploadedRelative = [];
      try {
        for (const f of files) {
          const ext = path.extname(f.originalname || "").toLowerCase();
          const safeExt = ext === ".png" || ext === ".jpg" || ext === ".jpeg" ? ext : ".png";
          const filename = `${randomUUID()}${safeExt}`;
          const storedRelative = path.join(seg, filename).replace(/\\/g, "/");
          const abs = logoFileAbsolutePath(storedRelative);
          const buffer = f.buffer;
          if (!buffer) {
            return res.status(400).json({ error: "Invalid upload (expected memory buffer)" });
          }
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, buffer);
          await putLogoObject(storedRelative, buffer, f.mimetype || "image/png");
          uploadedRelative.push(storedRelative);
          metas.push({
            originalName: f.originalname || filename,
            storedRelative,
            mime: f.mimetype || "image/png",
          });
        }
      } catch (uploadErr) {
        for (const rel of uploadedRelative) {
          try {
            await deleteLogoObject(rel);
          } catch {
            /* ignore */
          }
          try {
            await fs.unlink(logoFileAbsolutePath(rel));
          } catch {
            /* ignore */
          }
        }
        throw uploadErr;
      }
    } else {
      for (const f of files) {
        metas.push({
          originalName: f.originalname || f.filename,
          storedRelative: path.join(seg, f.filename).replace(/\\/g, "/"),
          mime: f.mimetype || "image/png",
        });
      }
    }

    const entries = await addChannelLogoEntries(channelId, metas);
    const doc = await readChannelSettings(channelId);
    const base = `/api/channels/${encodeURIComponent(channelId)}/settings/logos`;
    res.status(201).json({
      channelId: doc.channelId,
      added: entries.map((e) => ({
        ...e,
        previewUrl: `${base}/${encodeURIComponent(e.id)}/file`,
      })),
      logos: doc.logos.map((e) => ({
        ...e,
        previewUrl: `${base}/${encodeURIComponent(e.id)}/file`,
      })),
      updatedAt: doc.updatedAt,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

channelSettingsRouter.delete("/:channelId/settings/logos/:logoId", async (req, res) => {
  try {
    const removed = await removeChannelLogo(req.params.channelId, req.params.logoId);
    if (!removed) return res.status(404).json({ error: "Logo not found" });
    res.json({ ok: true, removedId: removed.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Remove precalculated ads + live probe snapshot for this channel (local JSON and S3 backup if configured). */
channelSettingsRouter.delete("/:channelId/settings/ads-snapshot", async (req, res) => {
  try {
    const channelId = req.params.channelId;
    const { localExisted } = await clearChannelAdsSnapshot(channelId);
    let s3 = { skipped: true };
    try {
      s3 = await deleteChannelAdsBackupObject(channelId);
    } catch (e) {
      return res.status(500).json({ error: `S3 delete failed: ${e.message}` });
    }
    res.json({
      ok: true,
      localRemoved: localExisted,
      s3: s3.skipped ? { skipped: true } : { deleted: Boolean(s3.deleted) },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

channelSettingsRouter.get("/:channelId/settings/logos/:logoId/file", async (req, res) => {
  try {
    const doc = await readChannelSettings(req.params.channelId);
    const entry = doc.logos.find((x) => x.id === req.params.logoId);
    if (!entry) return res.status(404).end();
    const abs = logoFileAbsolutePath(entry.storedRelative);
    res.setHeader("Content-Type", entry.mime || "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  } catch (e) {
    if (!res.headersSent) res.status(500).end();
  }
});
