/**
 * Resolve posterTypes / videoTypes from insight-api (same lookups as vods.service createClip).
 */

import axios from "axios";
import { config } from "../config.js";
import { getAuthToken } from "./auth.service.js";

async function entityFind(entityType, accountId, tenantId, filterExtra = "") {
  const url = `${config.insightApiBase}/cms/entity/${entityType}/find`;
  let filter = `accountId||$eq||${accountId}`;
  if (filterExtra) filter += `;${filterExtra}`;
  const authToken = await getAuthToken();
  const response = await axios.get(url, {
    params: { filter },
    headers: {
      "x-tenant-id": tenantId,
      Authorization: `Bearer ${authToken}`,
    },
  });
  const data = response.data;
  return Array.isArray(data) ? data : data ? [data] : [];
}

function fieldOf(row, key) {
  if (!row || typeof row !== "object") return undefined;
  if (row.fields && typeof row.fields === "object" && row.fields[key] != null) {
    return row.fields[key];
  }
  return row[key];
}

/**
 * @param {object} [row] posterTypes document
 * @returns {{ _id?: string, title?: string, aspect?: string, type?: string }}
 */
export function normalizePosterType(row) {
  if (!row) return {};
  return {
    _id: row._id != null ? String(row._id) : undefined,
    title: fieldOf(row, "title"),
    aspect: fieldOf(row, "aspect"),
    type: fieldOf(row, "type"),
  };
}

/**
 * @param {object} [row] videoTypes document
 */
export function normalizeVideoType(row) {
  if (!row) return { _id: null, name: "Main video" };
  return {
    _id: row._id != null ? String(row._id) : null,
    name: fieldOf(row, "name") || "Main video",
  };
}

/**
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {string} opts.tenantId
 * @returns {Promise<{ defaultPoster: object, posterForAssetType: (assetType: string) => object, videoType: object }>}
 */
export async function resolveInsightContentTypes({ accountId, tenantId }) {
  const [posterRows, videoRows] = await Promise.all([
    entityFind("posterTypes", accountId, tenantId).catch(() => []),
    entityFind("videoTypes", accountId, tenantId, "fields.value||$eq||main").catch(() => []),
  ]);

  const posterTypes = posterRows.map(normalizePosterType).filter((p) => p._id);
  const defaultPoster =
    posterTypes.find((p) => String(p.title || "").toLowerCase() === "default") ||
    posterTypes[0] ||
    {};

  const posterForAssetType = (assetType) => {
    const wanted = String(assetType || "Poster H");
    return (
      posterTypes.find((p) => String(p.type || "") === wanted) ||
      (wanted === "Poster H" ? defaultPoster : posterTypes[0]) ||
      defaultPoster
    );
  };

  const videoType = normalizeVideoType(videoRows[0]);

  return { defaultPoster, posterForAssetType, videoType };
}

/** @param {string} url */
export function extensionFromDownloadUrl(url) {
  const path = String(url || "").split("?")[0];
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "jpg";
  return path.slice(dot + 1).toLowerCase() || "jpg";
}

/** @param {string} format */
export function mimeTypeForImageFormat(format) {
  const f = String(format || "").toLowerCase();
  if (f === "png") return "image/png";
  if (f === "gif") return "image/gif";
  return "image/jpeg";
}
