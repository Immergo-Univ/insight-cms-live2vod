import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import {
  deleteLogoObject,
  getLogoBuffer,
  isS3LogosEnabled,
  putLogoObject,
} from "./s3-logos.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isValidEditorPosterId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

export function editorPostersPostersDirAbs() {
  return path.join(config.editorPosters.dataDir, "posters");
}

/**
 * @param {string} ext
 * @returns {string}
 */
export function mimeForPosterExt(ext) {
  const e = String(ext).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".gif") return "image/gif";
  return "image/jpeg";
}

/**
 * @param {Buffer} buffer
 * @param {string} [originalname]
 * @param {string} [mimetype]
 * @returns {Promise<{ id: string, originalName: string, storedRelative: string, mime: string }>}
 */
export async function saveEditorPosterFromBuffer(buffer, originalname, mimetype) {
  const ext = path.extname(originalname || "").toLowerCase();
  let safeExt = ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" ? ext : ".png";
  if (safeExt === ".png" && /^image\/gif$/i.test(mimetype || "")) safeExt = ".gif";
  const id = randomUUID();
  const storedRelative = `posters/${id}${safeExt}`;
  const abs = path.join(config.editorPosters.dataDir, storedRelative);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  if (isS3LogosEnabled()) {
    await putLogoObject(storedRelative, buffer, mimetype || mimeForPosterExt(safeExt));
  }
  return {
    id,
    originalName: originalname || `${id}${safeExt}`,
    storedRelative,
    mime: mimetype || mimeForPosterExt(safeExt),
  };
}

/**
 * @param {string} posterId
 * @returns {Promise<string | null>} absolute path on disk
 */
export async function resolveEditorPosterAbsPath(posterId) {
  if (!isValidEditorPosterId(posterId)) return null;
  const dir = editorPostersPostersDirAbs();
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  const name = names.find((n) => n.startsWith(`${posterId}.`));
  if (!name) return null;
  return path.join(dir, name);
}

/**
 * @param {string} posterId
 * @returns {Promise<{ buffer: Buffer, mime: string, storedRelative: string } | null>}
 */
export async function loadEditorPosterBuffer(posterId) {
  const abs = await resolveEditorPosterAbsPath(posterId);
  if (abs) {
    const ext = path.extname(abs).toLowerCase();
    const buf = await fs.readFile(abs);
    const id = path.basename(abs, ext);
    return {
      buffer: buf,
      mime: mimeForPosterExt(ext),
      storedRelative: `posters/${id}${ext}`,
    };
  }
  if (!isS3LogosEnabled()) return null;
  for (const ext of [".png", ".jpg", ".jpeg"]) {
    const storedRelative = `posters/${posterId}${ext}`;
    const buf = await getLogoBuffer(storedRelative);
    if (buf && buf.length > 0) {
      return {
        buffer: buf,
        mime: mimeForPosterExt(ext),
        storedRelative,
      };
    }
  }
  return null;
}

/**
 * @param {string} posterId
 * @returns {Promise<boolean>} true if something was removed
 */
export async function deleteEditorPoster(posterId) {
  if (!isValidEditorPosterId(posterId)) return false;
  const abs = await resolveEditorPosterAbsPath(posterId);
  let storedRelative = "";
  if (abs) {
    const ext = path.extname(abs).toLowerCase();
    storedRelative = `posters/${posterId}${ext}`;
    await fs.unlink(abs).catch(() => {});
  } else {
    for (const ext of [".png", ".jpg", ".jpeg"]) {
      const rel = `posters/${posterId}${ext}`;
      if (isS3LogosEnabled()) {
        const buf = await getLogoBuffer(rel);
        if (buf && buf.length > 0) {
          storedRelative = rel;
          break;
        }
      }
    }
  }
  if (!storedRelative) return false;
  if (isS3LogosEnabled()) {
    await deleteLogoObject(storedRelative).catch(() => {});
  }
  return true;
}
