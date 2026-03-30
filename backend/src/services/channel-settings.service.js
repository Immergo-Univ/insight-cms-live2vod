/**
 * Local per-channel settings (uploaded AD/logo templates). Persisted as JSON under data/channel-settings.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

function safeChannelSegment(channelId) {
  return String(channelId).replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function channelSettingsJsonPath(channelId) {
  return path.join(config.channelSettings.dataDir, `${safeChannelSegment(channelId)}.json`);
}

/**
 * @typedef {{ id: string, originalName: string, storedRelative: string, mime: string, uploadedAt: string }} ChannelLogoEntry
 */

/**
 * @returns {Promise<{ channelId: string, logos: ChannelLogoEntry[], updatedAt: string | null }>}
 */
export async function readChannelSettings(channelId) {
  const cid = String(channelId);
  try {
    const raw = await fs.readFile(channelSettingsJsonPath(cid), "utf8");
    const o = JSON.parse(raw);
    if (o && typeof o === "object") {
      return {
        channelId: cid,
        logos: Array.isArray(o.logos) ? o.logos : [],
        updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
      };
    }
  } catch (e) {
    if (e.code === "ENOENT") {
      return { channelId: cid, logos: [], updatedAt: null };
    }
    const isSyntax =
      e instanceof SyntaxError || (typeof e?.name === "string" && e.name === "SyntaxError");
    if (isSyntax) {
      console.warn(`[channel-settings] Invalid JSON (treating as empty): ${channelSettingsJsonPath(cid)}`);
      return { channelId: cid, logos: [], updatedAt: null };
    }
    throw e;
  }
  return { channelId: cid, logos: [], updatedAt: null };
}

async function writeChannelSettings(doc) {
  await fs.mkdir(config.channelSettings.dataDir, { recursive: true });
  const p = channelSettingsJsonPath(doc.channelId);
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await fs.rename(tmp, p);
}

/**
 * @param {string} channelId
 * @param {Array<{ originalName: string, storedRelative: string, mime: string }>} metas
 * @returns {Promise<ChannelLogoEntry[]>}
 */
export async function addChannelLogoEntries(channelId, metas) {
  const doc = await readChannelSettings(channelId);
  const now = new Date().toISOString();
  const added = [];
  for (const m of metas) {
    const entry = {
      id: randomUUID(),
      originalName: m.originalName,
      storedRelative: m.storedRelative,
      mime: m.mime,
      uploadedAt: now,
    };
    doc.logos.push(entry);
    added.push(entry);
  }
  doc.updatedAt = now;
  await writeChannelSettings(doc);
  return added;
}

/**
 * @param {string} channelId
 * @param {string} logoId
 * @returns {Promise<ChannelLogoEntry | null>}
 */
export async function removeChannelLogo(channelId, logoId) {
  const doc = await readChannelSettings(channelId);
  const idx = doc.logos.findIndex((x) => x.id === logoId);
  if (idx < 0) return null;
  const [removed] = doc.logos.splice(idx, 1);
  doc.updatedAt = new Date().toISOString();
  const abs = path.join(config.channelSettings.logosDir, removed.storedRelative);
  try {
    await fs.unlink(abs);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await writeChannelSettings(doc);
  return removed;
}

export function logoFileAbsolutePath(storedRelative) {
  return path.join(config.channelSettings.logosDir, storedRelative);
}

/**
 * @param {string} channelId
 * @returns {Promise<string[]>} existing absolute paths, in settings order
 */
export async function listUploadedLogoAbsolutePaths(channelId) {
  const doc = await readChannelSettings(channelId);
  const out = [];
  for (const e of doc.logos) {
    const abs = logoFileAbsolutePath(e.storedRelative);
    try {
      await fs.access(abs);
      out.push(abs);
    } catch {
      /* skip missing */
    }
  }
  return out;
}
