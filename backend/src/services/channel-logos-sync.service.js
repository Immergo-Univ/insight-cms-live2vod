/**
 * Pull channel logo manifests and files from S3 into local disk (source for logo-detector + API listing).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import {
  getLogoBuffer,
  getManifestJsonString,
  isS3LogosEnabled,
  listManifestObjectKeys,
} from "./s3-logos.service.js";
import { safeChannelSegment, writeChannelSettings } from "./channel-settings.service.js";

/**
 * @param {string} channelSegment filename segment (safeChannelSegment output)
 */
export async function syncOneChannelLogosFromS3(channelSegment) {
  const raw = await getManifestJsonString(channelSegment);
  if (!raw) return { ok: true, skipped: true, reason: "no_manifest" };

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    console.warn(`[channel-logos-sync] Invalid manifest JSON for segment ${channelSegment}`);
    return { ok: false, error: "invalid_manifest_json" };
  }

  if (!doc || typeof doc !== "object" || typeof doc.channelId !== "string") {
    return { ok: false, error: "invalid_manifest_shape" };
  }

  if (safeChannelSegment(doc.channelId) !== channelSegment) {
    console.warn(
      `[channel-logos-sync] Manifest segment mismatch: key ${channelSegment} vs channelId ${doc.channelId}`,
    );
    return { ok: false, error: "segment_mismatch" };
  }

  const logos = Array.isArray(doc.logos) ? doc.logos : [];
  const logosDir = config.channelSettings.logosDir;

  for (const e of logos) {
    if (!e || typeof e.storedRelative !== "string") continue;
    const buf = await getLogoBuffer(e.storedRelative);
    if (!buf) {
      console.warn(`[channel-logos-sync] Missing S3 object for ${e.storedRelative} (channel ${doc.channelId})`);
      continue;
    }
    const abs = path.join(logosDir, e.storedRelative);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
  }

  const toPersist = {
    channelId: doc.channelId,
    logos,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : new Date().toISOString(),
  };
  await writeChannelSettings(toPersist);
  return { ok: true, channelId: doc.channelId, fileCount: logos.length };
}

export async function syncAllChannelLogosFromS3() {
  if (!isS3LogosEnabled()) return { ok: true, skipped: true };

  const keys = await listManifestObjectKeys();
  const manifestPrefix = config.s3Logos.prefix ? `${config.s3Logos.prefix}/manifests/` : `manifests/`;
  let synced = 0;
  let errors = 0;

  for (const key of keys) {
    const seg = key.startsWith(manifestPrefix) ? key.slice(manifestPrefix.length).replace(/\.json$/i, "") : null;
    if (!seg) continue;
    try {
      const r = await syncOneChannelLogosFromS3(seg);
      if (r.ok && !r.skipped) synced += 1;
      if (!r.ok) errors += 1;
    } catch (e) {
      errors += 1;
      console.warn(`[channel-logos-sync] ${seg}: ${e.message}`);
    }
  }

  return { ok: true, manifests: keys.length, synced, errors };
}

/**
 * Periodic pull from S3 (initial sync is triggered separately on server listen).
 */
export function startChannelLogosS3Sync() {
  if (!isS3LogosEnabled()) return;

  const run = () => {
    syncAllChannelLogosFromS3().catch((e) => console.warn("[channel-logos-sync] cycle failed:", e.message));
  };

  const ms = Math.max(5000, config.s3Logos.syncIntervalMs);
  setInterval(run, ms);
  console.log(`[channel-logos-sync] Interval enabled (every ${ms}ms)`);
}
