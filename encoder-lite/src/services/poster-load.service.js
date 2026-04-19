/**
 * Resolve editor poster images for widget overlay (disk optional, S3, or HTTP against backend).
 */

import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { getLogoBuffer } from "./vod-s3.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isValidEditorPosterId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

/**
 * @param {string} ext
 * @returns {string}
 */
export function mimeForPosterExt(ext) {
  const e = String(ext).toLowerCase();
  if (e === ".png") return "image/png";
  return "image/jpeg";
}

/**
 * @param {string} posterId
 * @returns {Promise<{ buffer: Buffer, mime: string, storedRelative: string } | null>}
 */
export async function loadEditorPosterBuffer(posterId) {
  if (!isValidEditorPosterId(posterId)) return null;

  const dataDir = config.editorPostersDataDir;
  if (dataDir) {
    const postersDir = path.join(dataDir, "posters");
    try {
      const names = await fs.readdir(postersDir);
      const name = names.find((n) => n.startsWith(`${posterId}.`));
      if (name) {
        const abs = path.join(postersDir, name);
        const ext = path.extname(abs).toLowerCase();
        const buf = await fs.readFile(abs);
        return {
          buffer: buf,
          mime: mimeForPosterExt(ext),
          storedRelative: `posters/${posterId}${ext}`,
        };
      }
    } catch {
      /* fall through */
    }
  }

  if (config.s3Logos.enabled) {
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
  }

  return null;
}

/**
 * @param {string} pathname starts with /
 */
export async function fetchPosterFromBackendPath(pathname) {
  const base = config.backendBaseUrl;
  if (!base) return null;
  const url = `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const res = await fetchWithTimeout(
    url,
    {
      redirect: "follow",
      headers: {
        ...(process.env.VOD_WIDGET_IMAGE_FETCH_UA
          ? { "User-Agent": process.env.VOD_WIDGET_IMAGE_FETCH_UA }
          : {}),
      },
    },
    config.vodWidgetFetchTimeoutMs,
  );
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}
