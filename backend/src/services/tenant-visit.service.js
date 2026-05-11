import { getSequelize } from "../db/sequelize.js";

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
  return {
    tenantId: plain.tenantId,
    subtitlesEnabled: plain.subtitlesEnabled !== false,
    syndicationYoutubeEnabled: plain.syndicationYoutubeEnabled === true,
    syndicationYoutubeConnected: hasYoutubeToken || plain.syndicationYoutubeConnected === true,
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
