import { getSequelize } from "../db/sequelize.js";
import {
  deleteAllAccountsForPlatform,
  deleteSyndicationAccount,
  listAccountsForTenant,
} from "./tenant-syndication-accounts.service.js";
import { tenantRowToApi } from "./tenant-visit.service.js";
import { Op } from "sequelize";

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
}

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

function trendPercent(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseUsdEnv(name, fallback = 0) {
  const raw = String(process.env[name] || "").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Default USD assumptions when env vars are not set.
 *
 * Notes:
 * - YouTube Data API: no per-request monetary charge (quota-based), so default 0.
 * - Meta Graph / Pages / Instagram Graph: no per-request monetary charge, so default 0.
 * - TikTok Content Posting API: no published per-request paid tier, so default 0.
 * - X API: pay-per-usage. We use a conservative baseline for content create.
 *   Official pricing is endpoint-based and can change, so env overrides are recommended.
 */
const DEFAULT_PLATFORM_API_UNIT_COST_USD = {
  youtube: 0,
  twitter: 0.015,
  facebook: 0,
  instagram: 0,
  tiktok: 0,
};

function isCompletedEncodeJob(job) {
  const kind = typeof job.jobKind === "string" ? job.jobKind.trim() : "";
  if (kind && kind !== "vod_encode") return false;
  return job.status === "completed";
}

function extractEncodeMinutes(editorSpec) {
  if (!editorSpec || typeof editorSpec !== "object" || Array.isArray(editorSpec)) return 0;
  const clips = Array.isArray(editorSpec.clips) ? editorSpec.clips : [];
  let totalSec = 0;
  for (const c of clips) {
    if (!c || typeof c !== "object") continue;
    const start = safeNumber(c.startTime);
    const end = safeNumber(c.endTime);
    if (end > start) totalSec += end - start;
  }
  return totalSec > 0 ? totalSec / 60 : 0;
}

function summarizeOpenAiUsage(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return { totalTokens: 0, estimatedUsd: 0 };
  const steps = Array.isArray(report.steps) ? report.steps : [];
  const totalTokensFromReport = safeNumber(report.totalTokens);
  const totalTokensFromSteps = steps.reduce((sum, s) => sum + safeNumber(s?.totalTokens), 0);
  const usdFromReport = safeNumber(report.estimatedTotalUsd);
  const usdFromSteps = steps.reduce((sum, s) => sum + safeNumber(s?.estimatedUsd), 0);
  return {
    totalTokens: totalTokensFromReport > 0 ? totalTokensFromReport : totalTokensFromSteps,
    estimatedUsd: usdFromReport > 0 ? usdFromReport : usdFromSteps,
  };
}

function incrementSyndicationPublishedCounts(editorSpec, counters) {
  if (!editorSpec || typeof editorSpec !== "object" || Array.isArray(editorSpec)) return;
  const clips = Array.isArray(editorSpec.clips) ? editorSpec.clips : [];
  for (const clip of clips) {
    if (!clip || typeof clip !== "object") continue;
    const synd = clip.syndication;
    if (!synd || typeof synd !== "object" || Array.isArray(synd)) continue;
    for (const network of Object.keys(counters)) {
      const node = synd[network];
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const enabled = node.enabled === true;
      const upload = node.upload && typeof node.upload === "object" && !Array.isArray(node.upload) ? node.upload : {};
      const state = String(upload.state || "").trim().toLowerCase();
      if (enabled && state === "published") counters[network] += 1;
    }
  }
}

export async function adminListTenants() {
  const { Tenant } = models();
  const rows = await Tenant.findAll({ order: [["lastSeenAt", "DESC"]] });
  return rows.map((r) => tenantRowToApi(r.get({ plain: true })));
}

/**
 * @param {string} tenantId
 */
export async function adminGetTenant(tenantId) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  return row ? tenantRowToApi(row.get({ plain: true })) : null;
}

/**
 * @param {string} tenantId
 * @param {object} body
 */
export async function adminUpdateTenant(tenantId, body) {
  const { Tenant } = models();
  const row = await Tenant.findByPk(String(tenantId || "").trim());
  if (!row) return null;
  if (body.subtitlesEnabled !== undefined) row.subtitlesEnabled = Boolean(body.subtitlesEnabled);
  if (body.subtitlesDefaultEnabled !== undefined) row.subtitlesDefaultEnabled = Boolean(body.subtitlesDefaultEnabled);
  if (body.syndicationYoutubeEnabled !== undefined) {
    row.syndicationYoutubeEnabled = Boolean(body.syndicationYoutubeEnabled);
  }
  if (body.syndicationYoutubeDefaultEnabled !== undefined) {
    row.syndicationYoutubeDefaultEnabled = Boolean(body.syndicationYoutubeDefaultEnabled);
  }
  if (body.syndicationTwitterEnabled !== undefined) {
    row.syndicationTwitterEnabled = Boolean(body.syndicationTwitterEnabled);
  }
  if (body.syndicationTwitterDefaultEnabled !== undefined) {
    row.syndicationTwitterDefaultEnabled = Boolean(body.syndicationTwitterDefaultEnabled);
  }
  if (body.syndicationFacebookEnabled !== undefined) {
    row.syndicationFacebookEnabled = Boolean(body.syndicationFacebookEnabled);
  }
  if (body.syndicationFacebookDefaultEnabled !== undefined) {
    row.syndicationFacebookDefaultEnabled = Boolean(body.syndicationFacebookDefaultEnabled);
  }
  if (body.syndicationInstagramEnabled !== undefined) {
    row.syndicationInstagramEnabled = Boolean(body.syndicationInstagramEnabled);
  }
  if (body.syndicationInstagramDefaultEnabled !== undefined) {
    row.syndicationInstagramDefaultEnabled = Boolean(body.syndicationInstagramDefaultEnabled);
  }
  if (body.syndicationTiktokEnabled !== undefined) {
    row.syndicationTiktokEnabled = Boolean(body.syndicationTiktokEnabled);
  }
  if (body.syndicationTiktokDefaultEnabled !== undefined) {
    row.syndicationTiktokDefaultEnabled = Boolean(body.syndicationTiktokDefaultEnabled);
  }
  if (body.timezoneLastSeen !== undefined) row.timezoneLastSeen = body.timezoneLastSeen ? String(body.timezoneLastSeen).slice(0, 128) : null;
  if (body.metadata !== undefined) {
    row.metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : null;
  }
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

/**
 * Clear the tenant's YouTube OAuth refresh token and flip the connected flag off.
 * After this, the tenant must re-run the Google OAuth flow to publish again.
 *
 * @param {string} tenantId
 */
export async function adminDisconnectTenantYoutube(tenantId) {
  const id = String(tenantId || "").trim();
  await deleteAllAccountsForPlatform(id, "youtube");
  const { Tenant } = models();
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.youtubeRefreshToken = null;
  row.syndicationYoutubeConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

export async function adminDisconnectTenantTwitter(tenantId) {
  const id = String(tenantId || "").trim();
  await deleteAllAccountsForPlatform(id, "twitter");
  const { Tenant } = models();
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.twitterRefreshToken = null;
  row.syndicationTwitterConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

export async function adminDisconnectTenantFacebook(tenantId) {
  const id = String(tenantId || "").trim();
  await deleteAllAccountsForPlatform(id, "facebook");
  const { Tenant } = models();
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.facebookUserAccessToken = null;
  row.facebookPageId = null;
  row.facebookPageAccessToken = null;
  row.facebookPageName = null;
  row.syndicationFacebookConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

export async function adminDisconnectTenantInstagram(tenantId) {
  const id = String(tenantId || "").trim();
  await deleteAllAccountsForPlatform(id, "instagram");
  const { Tenant } = models();
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.instagramUserAccessToken = null;
  row.instagramBusinessAccountId = null;
  row.instagramUsername = null;
  row.instagramPageId = null;
  row.instagramPageAccessToken = null;
  row.syndicationInstagramConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

export async function adminDisconnectTenantTiktok(tenantId) {
  const id = String(tenantId || "").trim();
  await deleteAllAccountsForPlatform(id, "tiktok");
  const { Tenant } = models();
  const row = await Tenant.findByPk(id);
  if (!row) return null;
  row.tiktokRefreshToken = null;
  row.tiktokOpenId = null;
  row.tiktokUsername = null;
  row.syndicationTiktokConnected = false;
  await row.save();
  return tenantRowToApi(row.get({ plain: true }));
}

/**
 * @param {string} tenantId
 * @param {string} accountId
 */
export async function adminDisconnectSyndicationAccount(tenantId, accountId) {
  const id = String(tenantId || "").trim();
  const aid = String(accountId || "").trim();
  const row = await getAccountByIdForAdmin(id, aid);
  if (!row) return null;
  await deleteSyndicationAccount(aid);
  const { Tenant } = models();
  const tenant = await Tenant.findByPk(id);
  return tenant ? tenantRowToApi(tenant.get({ plain: true })) : null;
}

/**
 * @param {string} tenantId
 */
export async function adminListSyndicationAccounts(tenantId) {
  return listAccountsForTenant(String(tenantId || "").trim());
}

async function getAccountByIdForAdmin(tenantId, accountId) {
  const accounts = await listAccountsForTenant(tenantId);
  return accounts.find((a) => a.id === accountId) || null;
}

/**
 * Tenant dashboard metrics used by Admin tenant detail page.
 *
 * @param {string} tenantId
 */
export async function adminGetTenantDashboard(tenantId) {
  const { Tenant, VodJob } = models();
  const id = String(tenantId || "").trim();
  const tenant = await Tenant.findByPk(id);
  if (!tenant) return null;

  const now = new Date();
  const currentMonthStart = startOfUtcMonth(now);
  const previousMonthStart = addUtcMonths(currentMonthStart, -1);
  const nextMonthStart = addUtcMonths(currentMonthStart, 1);

  const dailyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  dailyStart.setUTCDate(dailyStart.getUTCDate() - 29);

  const rows = await VodJob.findAll({
    where: {
      tenantId: id,
      createdAt: { [Op.gte]: previousMonthStart },
    },
    order: [["createdAt", "ASC"]],
  });

  const currentJobs = [];
  const previousJobs = [];
  for (const row of rows) {
    const j = row.get({ plain: true });
    const created = new Date(j.createdAt);
    if (created >= currentMonthStart && created < nextMonthStart) currentJobs.push(j);
    else if (created >= previousMonthStart && created < currentMonthStart) previousJobs.push(j);
  }

  const currentCompletedEncode = currentJobs.filter(isCompletedEncodeJob);
  const previousCompletedEncode = previousJobs.filter(isCompletedEncodeJob);

  const monthlyClipCountCurrent = currentCompletedEncode.length;
  const monthlyClipCountPrevious = previousCompletedEncode.length;

  const encodeMinutesCurrent = currentCompletedEncode.reduce((sum, j) => sum + extractEncodeMinutes(j.editorSpec), 0);
  const encodeMinutesPrevious = previousCompletedEncode.reduce((sum, j) => sum + extractEncodeMinutes(j.editorSpec), 0);

  const syndicationCounts = {
    youtube: 0,
    twitter: 0,
    facebook: 0,
    instagram: 0,
    tiktok: 0,
  };
  for (const j of currentCompletedEncode) {
    incrementSyndicationPublishedCounts(j.editorSpec, syndicationCounts);
  }

  const apiUnitCosts = {
    youtube: parseUsdEnv("ADMIN_COST_YOUTUBE_USD_PER_VIDEO", DEFAULT_PLATFORM_API_UNIT_COST_USD.youtube),
    twitter: parseUsdEnv("ADMIN_COST_TWITTER_USD_PER_VIDEO", DEFAULT_PLATFORM_API_UNIT_COST_USD.twitter),
    facebook: parseUsdEnv("ADMIN_COST_FACEBOOK_USD_PER_VIDEO", DEFAULT_PLATFORM_API_UNIT_COST_USD.facebook),
    instagram: parseUsdEnv("ADMIN_COST_INSTAGRAM_USD_PER_VIDEO", DEFAULT_PLATFORM_API_UNIT_COST_USD.instagram),
    tiktok: parseUsdEnv("ADMIN_COST_TIKTOK_USD_PER_VIDEO", DEFAULT_PLATFORM_API_UNIT_COST_USD.tiktok),
  };
  const apiCostByNetwork = {};
  for (const key of Object.keys(syndicationCounts)) {
    const videos = syndicationCounts[key];
    const unitCostUsd = apiUnitCosts[key];
    apiCostByNetwork[key] = {
      videos,
      unitCostUsd,
      estimatedCostUsd: Number((videos * unitCostUsd).toFixed(6)),
    };
  }

  let aiTotalTokens = 0;
  let aiEstimatedCostUsd = 0;
  for (const j of currentJobs) {
    const agg = summarizeOpenAiUsage(j.openaiClipUsage);
    aiTotalTokens += agg.totalTokens;
    aiEstimatedCostUsd += agg.estimatedUsd;
  }

  const encodeCostPerMinute = parseUsdEnv("ADMIN_ENCODE_COST_USD_PER_MINUTE", 0);
  const encodeEstimatedCostUsd = Number((encodeMinutesCurrent * encodeCostPerMinute).toFixed(6));

  const dailyMap = new Map();
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(dailyStart);
    d.setUTCDate(d.getUTCDate() + i);
    const k = d.toISOString().slice(0, 10);
    dailyMap.set(k, 0);
  }
  for (const row of rows) {
    const j = row.get({ plain: true });
    if (!isCompletedEncodeJob(j)) continue;
    const created = new Date(j.createdAt);
    if (created < dailyStart) continue;
    const k = created.toISOString().slice(0, 10);
    if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) || 0) + 1);
  }

  return {
    monthlyClips: {
      current: monthlyClipCountCurrent,
      previous: monthlyClipCountPrevious,
      trendPercent: trendPercent(monthlyClipCountCurrent, monthlyClipCountPrevious),
    },
    syndicationVideosByNetwork: syndicationCounts,
    apiCostByNetwork,
    aiTokenUsage: {
      totalTokens: aiTotalTokens,
      estimatedCostUsd: Number(aiEstimatedCostUsd.toFixed(6)),
    },
    encodeUsage: {
      minutesCurrent: Number(encodeMinutesCurrent.toFixed(2)),
      minutesPrevious: Number(encodeMinutesPrevious.toFixed(2)),
      trendPercent: trendPercent(encodeMinutesCurrent, encodeMinutesPrevious),
      costPerMinuteUsd: encodeCostPerMinute,
      estimatedCostUsd: encodeEstimatedCostUsd,
    },
    dailyEncodeCounts: Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count })),
    generatedAt: new Date().toISOString(),
  };
}
