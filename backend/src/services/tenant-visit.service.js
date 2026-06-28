import { getSequelize } from "../db/sequelize.js";
import { normalizeSyndicationAccountMaxByPlatform } from "./tenant-syndication-account-limits.service.js";

/**
 * Create or update tenant row when the timeline (or app) is visited for a tenantId.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} [opts.timezone] IANA zone from ?tz=
 * @param {Record<string, unknown>} [opts.metadata] extra client metadata (merged shallowly on update)
 */
export async function ensureTenantVisited(opts) {
  const sequelize = getSequelize();
  if (!sequelize) throw new Error("Database not available");
  const { Tenant } = sequelize.models;

  const tenantId = String(opts.tenantId || "").trim();
  if (!tenantId) throw new Error("tenantId is required");

  const timezone = opts.timezone ? String(opts.timezone).trim().slice(0, 128) : null;
  const incomingMeta =
    opts.metadata && typeof opts.metadata === "object" && !Array.isArray(opts.metadata) ? opts.metadata : null;
  const now = new Date();

  const [row, created] = await Tenant.findOrCreate({
    where: { tenantId },
    defaults: {
      tenantId,
      subtitlesEnabled: true,
      subtitlesDefaultEnabled: false,
      timezoneLastSeen: timezone,
      metadata: incomingMeta,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });

  if (!created) {
    const prevMeta = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
    const nextMeta = incomingMeta ? { ...prevMeta, ...incomingMeta } : prevMeta;
    await row.update({
      lastSeenAt: now,
      ...(timezone ? { timezoneLastSeen: timezone } : {}),
      ...(incomingMeta ? { metadata: nextMeta } : {}),
    });
    await row.reload();
  }

  return tenantRowToApi(row.get({ plain: true }));
}

/**
 * @param {object} plain
 */
export function tenantRowToApi(plain) {
  const hasYoutubeToken = Boolean(plain.youtubeRefreshToken && String(plain.youtubeRefreshToken).trim());
  const hasTwitterToken = Boolean(plain.twitterRefreshToken && String(plain.twitterRefreshToken).trim());
  const hasFacebookUserToken = Boolean(plain.facebookUserAccessToken && String(plain.facebookUserAccessToken).trim());
  const facebookPageId =
    typeof plain.facebookPageId === "string" && plain.facebookPageId.trim() ? plain.facebookPageId.trim() : null;
  const facebookPageName =
    typeof plain.facebookPageName === "string" && plain.facebookPageName.trim() ? plain.facebookPageName.trim() : null;
  const hasFacebookPageToken = Boolean(plain.facebookPageAccessToken && String(plain.facebookPageAccessToken).trim());
  const hasIgUser = Boolean(plain.instagramUserAccessToken && String(plain.instagramUserAccessToken).trim());
  const igBusinessId =
    typeof plain.instagramBusinessAccountId === "string" && plain.instagramBusinessAccountId.trim()
      ? plain.instagramBusinessAccountId.trim()
      : null;
  const igUsername =
    typeof plain.instagramUsername === "string" && plain.instagramUsername.trim()
      ? plain.instagramUsername.trim()
      : null;
  const hasIgPageToken = Boolean(plain.instagramPageAccessToken && String(plain.instagramPageAccessToken).trim());
  const hasTiktokToken = Boolean(plain.tiktokRefreshToken && String(plain.tiktokRefreshToken).trim());
  const tiktokUsername =
    typeof plain.tiktokUsername === "string" && plain.tiktokUsername.trim() ? plain.tiktokUsername.trim() : null;
  return {
    tenantId: plain.tenantId,
    subtitlesEnabled: plain.subtitlesEnabled !== false,
    subtitlesDefaultEnabled: plain.subtitlesDefaultEnabled === true,
    subtitlesTranscriptNewsUiEnabled: plain.subtitlesTranscriptNewsUiEnabled !== false,
    subtitlesDefaultBurnIn: plain.subtitlesDefaultBurnIn === true,
    subtitlesDefaultDiarization: plain.subtitlesDefaultDiarization !== false,
    subtitlesDefaultInferSpeakerNames: plain.subtitlesDefaultInferSpeakerNames === true,
    subtitlesDefaultNewsEn: plain.subtitlesDefaultNewsEn !== false,
    subtitlesDefaultNewsEs: plain.subtitlesDefaultNewsEs !== false,
    subtitlesDefaultNewsHe: plain.subtitlesDefaultNewsHe !== false,
    syndicationYoutubeEnabled: plain.syndicationYoutubeEnabled === true,
    syndicationYoutubeDefaultEnabled: plain.syndicationYoutubeDefaultEnabled === true,
    syndicationYoutubeConnected: hasYoutubeToken || plain.syndicationYoutubeConnected === true,
    syndicationTwitterEnabled: plain.syndicationTwitterEnabled === true,
    syndicationTwitterDefaultEnabled: plain.syndicationTwitterDefaultEnabled === true,
    syndicationTwitterConnected: hasTwitterToken || plain.syndicationTwitterConnected === true,
    syndicationFacebookEnabled: plain.syndicationFacebookEnabled === true,
    syndicationFacebookDefaultEnabled: plain.syndicationFacebookDefaultEnabled === true,
    syndicationFacebookConnected: hasFacebookUserToken || plain.syndicationFacebookConnected === true,
    facebookPageId,
    facebookPageName,
    facebookPageSelected: Boolean(facebookPageId && hasFacebookPageToken),
    syndicationInstagramEnabled: plain.syndicationInstagramEnabled === true,
    syndicationInstagramDefaultEnabled: plain.syndicationInstagramDefaultEnabled === true,
    syndicationInstagramConnected: hasIgUser || plain.syndicationInstagramConnected === true,
    instagramBusinessAccountId: igBusinessId,
    instagramUsername: igUsername,
    instagramAccountSelected: Boolean(igBusinessId && hasIgPageToken),
    syndicationTiktokEnabled: plain.syndicationTiktokEnabled === true,
    syndicationTiktokDefaultEnabled: plain.syndicationTiktokDefaultEnabled === true,
    syndicationTiktokConnected: hasTiktokToken || plain.syndicationTiktokConnected === true,
    tiktokUsername,
    syndicationAccountMaxByPlatform: normalizeSyndicationAccountMaxByPlatform(plain.syndicationAccountMaxByPlatform),
    timezoneLastSeen: plain.timezoneLastSeen ?? null,
    metadata: plain.metadata ?? null,
    firstSeenAt: plain.firstSeenAt,
    lastSeenAt: plain.lastSeenAt,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

/**
 * @param {string} tenantId
 */
export async function getTenantById(tenantId) {
  const sequelize = getSequelize();
  if (!sequelize) return null;
  const { Tenant } = sequelize.models;
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  return tenantRowToApi(row.get({ plain: true }));
}
