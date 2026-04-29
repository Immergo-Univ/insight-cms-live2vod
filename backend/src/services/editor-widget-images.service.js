import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  saveEditorPosterFromBuffer,
  mimeForPosterExt,
} from "./editor-posters.service.js";
import { isS3LogosEnabled } from "./s3-logos.service.js";
import { putEditorWidgetImagePublic, sanitizeTenantSegment } from "./vod-s3.service.js";

/**
 * Ingest clip-widget image files from the editor UI: writes to S3 or disk and returns URLs/keys for preview and for the
 * remote encoder job spec. Does not render widgets into video (that runs only in encoder-lite: Playwright/sharp/ffmpeg).
 *
 * @param {string} channelId
 * @param {Buffer} buffer
 * @param {string} [originalname]
 * @param {string} [mimetype]
 * @returns {Promise<{ id: string, originalName: string, mime: string, src: string, previewUrl: string, storedRelative: string }>}
 */
export async function saveEditorWidgetImageForEncode(channelId, buffer, originalname, mimetype) {
  const ext = path.extname(originalname || "").toLowerCase();
  let safeExt = ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" ? ext : ".png";
  if (safeExt === ".png" && /^image\/gif$/i.test(mimetype || "")) safeExt = ".gif";
  const id = randomUUID();
  const seg = sanitizeTenantSegment(channelId);

  if (isS3LogosEnabled()) {
    const ct = mimetype || mimeForPosterExt(safeExt);
    const { key, publicUrl } = await putEditorWidgetImagePublic({
      channelSegment: seg,
      imageId: id,
      buffer,
      contentType: ct,
      extWithDot: safeExt,
    });
    const url = publicUrl || "";
    return {
      id,
      originalName: originalname || `${id}${safeExt}`,
      mime: ct,
      src: url,
      previewUrl: url,
      storedRelative: key,
    };
  }

  const meta = await saveEditorPosterFromBuffer(buffer, originalname, mimetype);
  const base = `/api/channels/${encodeURIComponent(channelId)}/editor/posters`;
  const previewUrl = `${base}/${encodeURIComponent(meta.id)}/file`;
  return {
    id: meta.id,
    originalName: meta.originalName,
    mime: meta.mime,
    storedRelative: meta.storedRelative,
    src: previewUrl,
    previewUrl,
  };
}
