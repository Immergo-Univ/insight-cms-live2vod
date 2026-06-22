/**
 * Resolves tenant video encoding profiles from insight-api (Mongo `videoProfiles`),
 * mirroring insight-api vods.service createClip behaviour.
 */

import axios from "axios";
import { config } from "../config.js";
import { getAuthToken } from "./auth.service.js";

/** Same defaults as insight-api environment.renditions. */
export const DEFAULT_VIDEO_PROFILES = [
  { res: "640x360", br: "800k", fps: 30, crf: 30, gop: 60, ab: "128k" },
  { res: "960x540", br: "1200k", fps: 30, crf: 30, gop: 60, ab: "128k" },
  { res: "1280x720", br: "4000k", fps: 30, crf: 30, gop: 60, ab: "128k" },
];

async function entityFind(entityType, accountId, tenantId) {
  const url = `${config.insightApiBase}/cms/entity/${entityType}/find`;
  const filter = `accountId||$eq||${accountId}`;
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

/**
 * Map insight-api videoProfile document to immergo encoder rendition shape.
 * @param {object} profile
 */
export function mapProfileToEncoderRendition(profile) {
  const br = profile.br || profile.bitrate || "2500k";
  return {
    resolution: profile.res || profile.resolution || "1280x720",
    bitrate: br,
    minBitrate: profile.minBitrate || br,
    maxBitrate: profile.maxBitrate || br,
    fps: String(profile.fps ?? 30),
    crf: String(profile.crf ?? 30),
    gopSize: String(profile.gop ?? profile.gopSize ?? 60),
    audioBitrate: profile.ab || profile.audioBitrate || "128k",
    notGenerateMp4: profile.notGenerateMp4 === true,
    title: profile.title,
    description: profile.description,
    aspectRatio: profile.aspectRatio,
    // Keep legacy field names for content[] URL building.
    res: profile.res || profile.resolution,
    br,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {string} opts.tenantId
 * @returns {Promise<Array<object>>} Encoder-ready renditions (legacy field names included).
 */
export async function resolveTenantVideoProfiles({ accountId, tenantId }) {
  if (!accountId || !tenantId) {
    return DEFAULT_VIDEO_PROFILES.map(mapProfileToEncoderRendition);
  }

  try {
    const profiles = await entityFind("videoProfiles", accountId, tenantId);
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return DEFAULT_VIDEO_PROFILES.map(mapProfileToEncoderRendition);
    }
    return profiles.map(mapProfileToEncoderRendition);
  } catch {
    return DEFAULT_VIDEO_PROFILES.map(mapProfileToEncoderRendition);
  }
}
