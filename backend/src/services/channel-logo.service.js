/**
 * Channel logo samples: storage + retrieval for the AD-recognition logo stage.
 *
 * The AD scheduler auto-collects up to `config.adRecognition.logoSamplesTarget` (default 30) logo
 * ROI crops per channel while it's confidently showing programming. Crops are uploaded to S3
 * (public) and one row per crop is recorded in `channel_logo_samples`. Once the target is reached,
 * collection stops and the stored crops become the templates the microservice matches against to
 * decide logo present (program) vs. gone (ad).
 *
 * This module is the single place that touches the model + S3 for logos, reused by both the
 * scheduler and the admin API.
 */

import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { getSequelize } from "../db/sequelize.js";
import { putChannelLogoSamplePublic, deleteS3ObjectByKey } from "./vod-s3.service.js";

function getModel() {
  const sequelize = getSequelize();
  return sequelize?.models?.ChannelLogoSample || null;
}

/** How many logo samples we keep per channel before we stop auto-collecting. */
export function logoSamplesTarget() {
  return Math.max(1, config.adRecognition.logoSamplesTarget);
}

/** @param {string} channelId */
export async function countChannelLogoSamples(channelId) {
  const Model = getModel();
  if (!Model || !channelId) return 0;
  try {
    return await Model.count({ where: { channelId: String(channelId) } });
  } catch {
    return 0;
  }
}

/**
 * Load the ROI + up to `maxTemplates` public template URLs for a channel (for the match stage).
 * Returns null when there aren't enough samples yet.
 * @param {string} channelId
 */
export async function loadChannelLogoTemplates(channelId) {
  const Model = getModel();
  if (!Model || !channelId) return null;
  let rows;
  try {
    rows = await Model.findAll({
      where: { channelId: String(channelId) },
      order: [["createdAt", "DESC"]],
      limit: Math.max(1, config.adRecognition.logoTemplatesToSend),
    });
  } catch {
    return null;
  }
  const items = (rows || []).map((r) => r.get({ plain: true })).filter((r) => r.publicUrl);
  if (items.length === 0) return null;
  // Use the ROI of the most recent sample (they should all share the same detected corner).
  const roi = items[0].roi || null;
  const templates = items.map((r) => r.publicUrl);
  if (!roi || templates.length === 0) return null;
  return { roi, templates };
}

/**
 * Store one auto-collected logo sample: upload the crop to S3 + insert a DB row.
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.channelId
 * @param {string} args.base64  JPEG crop, base64-encoded (from the microservice)
 * @param {object|null} args.roi normalized ROI
 * @param {number|null} args.confidence
 * @param {string|null} args.hlsUrl
 * @returns {Promise<object|null>} the created row (plain) or null
 */
export async function storeChannelLogoSample({ tenantId, channelId, base64, roi, confidence, hlsUrl }) {
  const Model = getModel();
  if (!Model || !channelId || !base64) return null;
  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (!buffer || buffer.length < 64) return null;

  const sampleId = randomUUID();
  let s3Key = null;
  let publicUrl = null;
  try {
    const up = await putChannelLogoSamplePublic(channelId, sampleId, buffer);
    s3Key = up.key;
    publicUrl = up.publicUrl;
  } catch (e) {
    console.warn("[ad-recognition] logo sample S3 upload failed:", e && e.message ? e.message : e);
    return null; // without S3 we can't serve/match it, so don't create an orphan row
  }

  try {
    const row = await Model.create({
      tenantId: tenantId || "",
      channelId: String(channelId),
      s3Key,
      publicUrl,
      roi: roi || null,
      confidence: typeof confidence === "number" ? confidence : null,
      hlsUrl: hlsUrl || null,
      source: "auto",
    });
    return row.get({ plain: true });
  } catch (e) {
    console.warn("[ad-recognition] logo sample DB insert failed:", e && e.message ? e.message : e);
    return null;
  }
}

/**
 * List all logo samples for a channel (for the admin catalog).
 * @param {string} channelId
 */
export async function listChannelLogoSamples(channelId) {
  const Model = getModel();
  if (!Model || !channelId) return [];
  const rows = await Model.findAll({
    where: { channelId: String(channelId) },
    order: [["createdAt", "ASC"]],
  });
  return (rows || []).map((r) => {
    const p = r.get({ plain: true });
    return {
      id: String(p.id),
      channelId: p.channelId,
      tenantId: p.tenantId,
      publicUrl: p.publicUrl,
      roi: p.roi,
      confidence: p.confidence,
      source: p.source,
      createdAt: p.createdAt,
    };
  });
}

/**
 * Delete one logo sample (S3 object + DB row).
 * @param {string} channelId
 * @param {string} sampleId
 */
export async function deleteChannelLogoSample(channelId, sampleId) {
  const Model = getModel();
  if (!Model || !channelId || !sampleId) return false;
  const row = await Model.findOne({ where: { id: sampleId, channelId: String(channelId) } });
  if (!row) return false;
  const p = row.get({ plain: true });
  if (p.s3Key) await deleteS3ObjectByKey(p.s3Key);
  await row.destroy();
  return true;
}

export default {
  logoSamplesTarget,
  countChannelLogoSamples,
  loadChannelLogoTemplates,
  storeChannelLogoSample,
  listChannelLogoSamples,
  deleteChannelLogoSample,
};
