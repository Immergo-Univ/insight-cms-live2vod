/**
 * Resolve editor clip posters (capture thumbnails + uploaded stills) and upload them
 * to the tenant's transcoded S3 folder before insight-api content[] is written.
 */

import { config } from "../config.js";
import { extensionFromDownloadUrl } from "./insight-content-types.service.js";
import { loadEditorPosterBuffer, mimeForPosterExt } from "./editor-posters.service.js";
import { putTenantTranscodedObject } from "./vod-tenant-s3.service.js";

/**
 * @param {object} spec
 * @param {string} [editorClipId]
 * @returns {object | null}
 */
function resolveClipForPosters(spec, editorClipId) {
  const clips = Array.isArray(spec?.clips) ? spec.clips : [];
  if (clips.length === 0) return null;
  if (editorClipId) {
    return (
      clips.find((c) => String(c?.editorClientClipId || "") === String(editorClipId)) || clips[0]
    );
  }
  return clips[0];
}

/**
 * @param {string} mime
 * @returns {{ format: string, ext: string }}
 */
function formatFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return { format: "png", ext: ".png" };
  if (m.includes("gif")) return { format: "gif", ext: ".gif" };
  return { format: "jpg", ext: ".jpg" };
}

/**
 * @param {string} clipUrl
 * @param {number} timeSeconds
 * @param {string} channelId
 * @returns {string}
 */
function buildThumbnailFetchUrl(clipUrl, timeSeconds, channelId) {
  const base = (config.thumbnailApiBase || "").trim();
  if (!base || !clipUrl || !channelId) return "";
  const params = new URLSearchParams();
  params.set("url", clipUrl);
  params.set("time", String(timeSeconds));
  params.set("channelId", channelId);
  return `${base}?${params.toString()}`;
}

/**
 * @param {object} poster editor clip poster entry
 * @param {{ clipUrl: string, channelId: string }} ctx
 * @returns {Promise<{ buffer: Buffer, mime: string, ext: string } | null>}
 */
async function resolvePosterImageBuffer(poster, ctx) {
  if (!poster || typeof poster !== "object") return null;

  if (poster.kind === "upload") {
    const posterId = String(poster.id || "").trim();
    if (!posterId) return null;
    const loaded = await loadEditorPosterBuffer(posterId);
    if (!loaded?.buffer?.length) return null;
    const ext = poster.storedRelative
      ? String(poster.storedRelative).match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase() || ".jpg"
      : formatFromMime(loaded.mime).ext;
    return {
      buffer: loaded.buffer,
      mime: loaded.mime || mimeForPosterExt(ext),
      ext,
    };
  }

  if (poster.kind === "capture") {
    const thumbUrl = buildThumbnailFetchUrl(
      ctx.clipUrl,
      Number(poster.timeSeconds) || 0,
      ctx.channelId,
    );
    if (!thumbUrl) return null;
    const res = await fetch(thumbUrl, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) {
      throw new Error(`Thumbnail fetch failed (${res.status}) for capture poster`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const mime = res.headers.get("content-type") || "image/jpeg";
    return { buffer: buf, mime, ext: formatFromMime(mime).ext };
  }

  return null;
}

/**
 * Primary poster follows immergo layout: always Poster H at poster.jpg (Elements preview uses Poster H).
 * Additional editor posters may use Poster V when captured in portrait mode.
 * @param {object} poster
 * @param {number} index
 * @returns {"Poster H" | "Poster V"}
 */
function posterAssetType(poster, index) {
  if (index === 0) return "Poster H";
  const o = String(poster?.orientation || "").toLowerCase();
  return o === "portrait" ? "Poster V" : "Poster H";
}

/**
 * Upload editor posters for a VOD guid to tenant S3 and return insight content metadata.
 *
 * @param {object} opts
 * @param {object} opts.s3 resolved tenant S3
 * @param {string} opts.tenantId
 * @param {string} opts.guid
 * @param {object} opts.spec editor spec
 * @param {string} [opts.editorClipId]
 * @param {string} opts.baseUrl public CDN base for this guid (no trailing slash)
 * @returns {Promise<Array<{ publicUrl: string, assetType: string, mime: string, format: string, default: boolean }>>}
 */
export async function uploadEditorPostersForVod({
  s3,
  tenantId,
  guid,
  spec,
  editorClipId,
  baseUrl,
}) {
  const clip = resolveClipForPosters(spec, editorClipId);
  const posters = Array.isArray(clip?.posters) ? clip.posters : [];
  if (posters.length === 0) return [];

  const ctx = {
    clipUrl: String(spec?.clipUrl || "").trim(),
    channelId: String(spec?.channelId || "").trim(),
  };

  /** @type {Array<{ publicUrl: string, assetType: string, mime: string, format: string, default: boolean }>} */
  const uploaded = [];

  for (let i = 0; i < posters.length; i++) {
    const poster = posters[i];
    const image = await resolvePosterImageBuffer(poster, ctx);
    if (!image) continue;

    const { ext } = { ext: formatFromMime(image.mime).ext };
    const fileName = i === 0 ? "poster.jpg" : `poster_${poster.id || i}${ext}`;

    await putTenantTranscodedObject({
      s3,
      tenantId,
      guid,
      fileName,
      body: image.buffer,
      contentType: image.mime,
    });

    uploaded.push({
      publicUrl: `${baseUrl}/${fileName}`,
      assetType: posterAssetType(poster, i),
      mime: image.mime,
      format: extensionFromDownloadUrl(`${baseUrl}/${fileName}`),
      default: i === 0,
    });
  }

  return uploaded;
}

/**
 * @param {object} spec
 * @returns {boolean}
 */
export function specHasEditorClipPosters(spec) {
  const clips = Array.isArray(spec?.clips) ? spec.clips : [];
  return clips.some((c) => Array.isArray(c?.posters) && c.posters.length > 0);
}
