/**
 * Admin "Streams" tab: list a tenant's live channels that have archive enabled, and the stored
 * AD-recognition scan history for a channel (from the ad_recognition_scans table).
 */

import { getSequelize } from "../db/sequelize.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive, mapChannelData } from "./channels.service.js";

/** Effective probe URL preference — must match the scheduler's channelHlsUrl(). */
function effectiveHlsUrl(channel) {
  return channel.hlsStream || channel.hlsMaster || "";
}

/**
 * List the tenant's archive-enabled streams, each with a lightweight scan summary.
 * @param {string} tenantId
 */
export async function adminListTenantStreams(tenantId) {
  const id = String(tenantId || "").trim();
  if (!id) return [];

  const t = await resolveTenant(id);
  const rows = await fetchChannelsWithArchive({ accountId: t.accountId, tenantId: id });
  const channels = rows.map(mapChannelData);

  const sequelize = getSequelize();
  const Model = sequelize?.models?.AdRecognitionScan;

  const out = [];
  for (const c of channels) {
    const channelId = String(c.id || "");
    let scanCount = 0;
    let lastScan = null;

    if (Model && channelId) {
      try {
        scanCount = await Model.count({ where: { channelId } });
        const row = await Model.findOne({
          where: { channelId },
          order: [["scannedAt", "DESC"]],
        });
        if (row) {
          const p = row.get({ plain: true });
          lastScan = {
            detection: p.detection,
            score: p.score,
            error: p.error,
            probeEpoch: p.probeEpoch != null ? Number(p.probeEpoch) : null,
            scannedAt: p.scannedAt,
          };
        }
      } catch {
        /* scan summary is best-effort */
      }
    }

    out.push({
      channelId,
      title: c.title || "",
      hlsStream: c.hlsStream || "",
      hlsMaster: c.hlsMaster || "",
      effectiveHls: effectiveHlsUrl(c),
      archive: c.archive === true,
      posterUrl: c.posterUrl || "",
      scanCount,
      lastScan,
    });
  }
  return out;
}

/**
 * Full scan history for one channel, newest first.
 * @param {string} _tenantId
 * @param {string} channelId
 * @param {{ limit?: number }} [opts]
 */
export async function adminListChannelScans(_tenantId, channelId, opts = {}) {
  const cid = String(channelId || "").trim();
  if (!cid) return [];

  const sequelize = getSequelize();
  const Model = sequelize?.models?.AdRecognitionScan;
  if (!Model) return [];

  const limit = Math.min(Math.max(1, Number(opts.limit) || 1000), 5000);
  const rows = await Model.findAll({
    where: { channelId: cid },
    order: [["scannedAt", "DESC"]],
    limit,
  });

  return rows.map((r) => {
    const p = r.get({ plain: true });
    return {
      id: String(p.id),
      tenantId: p.tenantId,
      channelId: p.channelId,
      channelTitle: p.channelTitle,
      hlsUrl: p.hlsUrl,
      detection: p.detection,
      score: p.score,
      confidence: p.confidence,
      scores: p.scores,
      transcript: p.transcript,
      ocrText: p.ocrText,
      profile: p.profile,
      error: p.error,
      probeEpoch: p.probeEpoch != null ? Number(p.probeEpoch) : null,
      scannedAt: p.scannedAt,
      createdAt: p.createdAt,
    };
  });
}
