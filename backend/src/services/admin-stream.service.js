/**
 * Admin "Streams" tab: list a tenant's live channels that have archive enabled, and the stored
 * AD-recognition scan history for a channel (from the ad_recognition_scans table).
 */

import { config } from "../config.js";
import { getSequelize } from "../db/sequelize.js";
import { resolveTenant } from "./auth.service.js";
import { fetchChannelsWithArchive, mapChannelData } from "./channels.service.js";
import { buildProbeUrl } from "./ad-recognition.service.js";

/** Effective probe URL preference — must match the scheduler's channelHlsUrl(). */
function effectiveHlsUrl(channel) {
  return channel.hlsStream || channel.hlsMaster || "";
}

/** Build a longer archive window (for the Player tab so the operator can scrub) — ~5 min back. */
function buildPlayerUrl(hls) {
  try {
    const u = new URL(hls);
    if (u.searchParams.has("startTime") || u.searchParams.has("endTime")) return u.toString();
    if (/archive|fillgaps|encoders\.immergo\.tv/i.test(hls)) {
      const now = Math.floor(Date.now() / 1000);
      const end = now - config.adRecognition.archiveMarginSec;
      const start = end - 300;
      u.searchParams.set("startTime", String(start));
      u.searchParams.set("endTime", String(end));
    }
    return u.toString();
  } catch {
    return hls;
  }
}

/**
 * Resolve a channel's base video resolution + fps (via the microservice /probe) plus a playable
 * archive URL for the admin Player tab. Best-effort: returns nulls if probing fails.
 * @param {string} tenantId
 * @param {string} channelId
 */
export async function adminGetStreamInfo(tenantId, channelId) {
  const empty = { width: null, height: null, fps: null, duration: null, hls: null, playerUrl: null };
  const cid = String(channelId || "").trim();
  if (!cid) return empty;

  const t = await resolveTenant(tenantId);
  const rows = await fetchChannelsWithArchive({ accountId: t.accountId, tenantId });
  const channels = rows.map(mapChannelData);
  const ch = channels.find((c) => String(c.id) === cid);
  if (!ch) return empty;

  const hls = effectiveHlsUrl(ch);
  const playerUrl = buildPlayerUrl(hls);
  const probeUrl = buildProbeUrl(hls);

  let info = { width: null, height: null, fps: null, duration: null };
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), config.adRecognition.requestTimeoutMs);
    const res = await fetch(`${config.adRecognition.baseUrl}/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-secret": config.adRecognition.secret },
      body: JSON.stringify({ video: probeUrl }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (res.ok) info = await res.json();
  } catch (e) {
    console.warn("[admin-stream] stream-info probe failed:", e && e.message ? e.message : e);
  }

  return { ...info, hls, playerUrl };
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
      // `confidence` stores the ad/program threshold applied for this scan.
      threshold: p.confidence,
      scores: p.scores,
      ocrText: p.ocrText,
      ocrTextTranslated: p.ocrTextTranslated,
      elapsedMs: p.elapsedMs != null ? Number(p.elapsedMs) : null,
      strategyResults: p.strategyResults,
      error: p.error,
      probeEpoch: p.probeEpoch != null ? Number(p.probeEpoch) : null,
      scannedAt: p.scannedAt,
      createdAt: p.createdAt,
    };
  });
}
