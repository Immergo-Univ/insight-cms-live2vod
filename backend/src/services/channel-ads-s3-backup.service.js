/**
 * S3 backup for per-channel ads/timeline JSON (data/channels/<id>.json).
 * - Startup: pull objects under {S3 prefix}/channel-ads/*.json when S3 copy is newer than local (or local missing).
 * - After each disk merge: upload handled in channel-ads-disk.service.js (fire-and-forget).
 */

import fs from "fs/promises";
import {
  getS3ObjectUtf8,
  isS3LogosEnabled,
  listChannelAdsBackupObjects,
} from "./s3-logos.service.js";
import {
  getChannelSnapshotPath,
  readChannelSnapshotById,
  writeChannelSnapshotDocument,
} from "./channel-ads-disk.service.js";

async function localSnapshotMtimeMs(filePath, localDoc) {
  if (localDoc?.updatedAt) {
    const t = Date.parse(String(localDoc.updatedAt));
    if (Number.isFinite(t)) return t;
  }
  try {
    const st = await fs.stat(filePath);
    return st.mtimeMs;
  } catch {
    return 0;
  }
}

function isSnapshotDoc(o) {
  return o && typeof o === "object" && typeof o.channelId === "string" && o.channelId.trim().length > 0;
}

/**
 * Restore channel snapshots from S3 before schedulers use on-disk data.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, restored: number, errors: number }>}
 */
export async function syncChannelAdsSnapshotsFromS3OnStartup() {
  if (!isS3LogosEnabled()) return { ok: true, skipped: true, restored: 0, errors: 0 };

  let restored = 0;
  let errors = 0;
  const entries = await listChannelAdsBackupObjects();

  for (const { key, lastModified } of entries) {
    const s3Ms = lastModified.getTime();
    try {
      const raw = await getS3ObjectUtf8(key);
      if (!raw) continue;
      const doc = JSON.parse(raw);
      if (!isSnapshotDoc(doc)) continue;

      const channelId = doc.channelId.trim();
      const localPath = getChannelSnapshotPath(channelId);
      const localDoc = await readChannelSnapshotById(channelId);
      const localMs = await localSnapshotMtimeMs(localPath, localDoc);
      if (s3Ms <= localMs) continue;

      await writeChannelSnapshotDocument(doc);
      restored += 1;
    } catch (e) {
      errors += 1;
      const msg = e && typeof e.message === "string" ? e.message : String(e);
      console.warn(`[channel-ads-s3] restore failed for key ${key}:`, msg);
    }
  }

  if (restored > 0 || errors > 0) {
    console.log(
      `[channel-ads-s3] Startup backup sync: restored=${restored} from S3` + (errors ? `, errors=${errors}` : ""),
    );
  }

  return { ok: true, restored, errors };
}
