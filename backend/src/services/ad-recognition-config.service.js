/**
 * Per-channel AD-recognition config: storage + retrieval for the admin "Ad Recognition Setup" tab.
 *
 * The config is a JSONB rule-engine setup (logo appearance / disappearance / OCR rules + threshold)
 * edited from the admin UI and posted to the microservice on every probe. Uploaded template samples
 * are stored on S3 (public) and their perceptual hash + OCR text are precomputed once via the
 * microservice `/sample` endpoint, so detection never re-downloads the images.
 *
 * This module is the single place that touches the config model + the sample S3 objects, reused by
 * both the scheduler (read) and the admin API (read/write/upload/delete).
 */

import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { getSequelize } from "../db/sequelize.js";
import {
  putAdRecognitionSamplePublic,
  deleteS3ObjectByKey,
  adRecognitionSampleObjectKey,
} from "./vod-s3.service.js";

function getModel() {
  const sequelize = getSequelize();
  return sequelize?.models?.AdRecognitionConfig || null;
}

/** Empty/default config used when a channel has never been configured. */
export function emptyConfig() {
  return {
    threshold: 0.5,
    logoAppearance: { enabled: false, instances: [] },
    logoDisappearance: { enabled: false, instances: [] },
    ocrRules: { enabled: false, groups: [] },
  };
}

/** True when at least one strategy is enabled (so the scheduler should probe this channel). */
export function hasActiveStrategies(cfg) {
  if (!cfg || typeof cfg !== "object") return false;
  return Boolean(
    cfg.logoAppearance?.enabled || cfg.logoDisappearance?.enabled || cfg.ocrRules?.enabled,
  );
}

/**
 * Read a channel's config (plain object) or null when none exists.
 * @param {string} channelId
 */
export async function getChannelConfig(channelId) {
  const Model = getModel();
  if (!Model || !channelId) return null;
  try {
    const row = await Model.findOne({ where: { channelId: String(channelId) } });
    if (!row) return null;
    const p = row.get({ plain: true });
    return { channelId: p.channelId, tenantId: p.tenantId, config: p.config || emptyConfig() };
  } catch {
    return null;
  }
}

/**
 * Create or update a channel's config.
 * @param {string} tenantId
 * @param {string} channelId
 * @param {object} cfg
 */
export async function upsertChannelConfig(tenantId, channelId, cfg) {
  const Model = getModel();
  if (!Model || !channelId) throw new Error("AdRecognitionConfig model unavailable");
  const clean = cfg && typeof cfg === "object" ? cfg : emptyConfig();
  const existing = await Model.findOne({ where: { channelId: String(channelId) } });
  if (existing) {
    existing.set({ tenantId: tenantId || existing.get("tenantId"), config: clean });
    await existing.save();
    const p = existing.get({ plain: true });
    return { channelId: p.channelId, tenantId: p.tenantId, config: p.config };
  }
  const row = await Model.create({
    tenantId: tenantId || "",
    channelId: String(channelId),
    config: clean,
  });
  const p = row.get({ plain: true });
  return { channelId: p.channelId, tenantId: p.tenantId, config: p.config };
}

/** Call the microservice `/sample` to precompute pHash + OCR (+ English translation). */
async function analyzeSampleViaMicroservice(imageUrl) {
  const url = `${config.adRecognition.baseUrl}/sample`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.adRecognition.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": config.adRecognition.secret,
      },
      body: JSON.stringify({ imageUrl }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`sample HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Upload one template sample image (base64) for a channel: store it on S3 (public) and precompute
 * its pHash + OCR text via the microservice. Returns the descriptor the admin UI embeds in the
 * strategy instance's `samples` array.
 *
 * @param {object} args
 * @param {string} args.channelId
 * @param {string} args.base64  raw base64 (optionally a data: URL)
 * @param {string} [args.contentType]
 * @returns {Promise<{ id, s3Key, url, phash, ocrText, ocrTextEn }>}
 */
export async function uploadSample({ channelId, base64, contentType }) {
  if (!channelId) throw new Error("channelId required");
  if (typeof base64 !== "string" || !base64.length) throw new Error("image data required");

  const stripped = base64.replace(/^data:([^;]+);base64,/, (_m, ct) => {
    if (!contentType) contentType = ct;
    return "";
  });
  const buffer = Buffer.from(stripped, "base64");
  if (!buffer || buffer.length < 64) throw new Error("image too small / invalid");

  const ext = contentType && /png/i.test(contentType) ? ".png" : ".jpg";
  const ct = ext === ".png" ? "image/png" : "image/jpeg";
  const sampleId = randomUUID();

  const up = await putAdRecognitionSamplePublic(channelId, sampleId, buffer, ct, ext);

  let analysis = { phash: "", ocrText: "", ocrTextEn: "" };
  try {
    const out = await analyzeSampleViaMicroservice(up.publicUrl);
    if (out && typeof out === "object") {
      analysis = {
        phash: typeof out.phash === "string" ? out.phash : "",
        ocrText: typeof out.ocrText === "string" ? out.ocrText : "",
        ocrTextEn: typeof out.ocrTextEn === "string" ? out.ocrTextEn : "",
      };
    }
  } catch (e) {
    // The image is stored; without the pHash the pHash strategy just won't match until re-uploaded.
    console.warn("[ad-recognition] sample analysis failed:", e && e.message ? e.message : e);
  }

  return {
    id: sampleId,
    s3Key: up.key,
    url: up.publicUrl,
    phash: analysis.phash,
    ocrText: analysis.ocrText,
    ocrTextEn: analysis.ocrTextEn,
  };
}

/**
 * Delete a template sample's S3 object (called when the admin removes a sample from a strategy).
 * Accepts an s3Key directly, or a (channelId, sampleId) pair to derive it.
 * @param {{ s3Key?: string, channelId?: string, sampleId?: string }} args
 */
export async function deleteSample({ s3Key, channelId, sampleId }) {
  let key = s3Key;
  if (!key && channelId && sampleId) key = adRecognitionSampleObjectKey(channelId, sampleId);
  if (!key) return false;
  return deleteS3ObjectByKey(key);
}

export default {
  emptyConfig,
  hasActiveStrategies,
  getChannelConfig,
  upsertChannelConfig,
  uploadSample,
  deleteSample,
};
