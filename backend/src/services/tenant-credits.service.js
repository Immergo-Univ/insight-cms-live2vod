import crypto from "crypto";
import { getSequelize } from "../db/sequelize.js";
import { getJob } from "./vod-jobs.store.js";
import {
  aggregateUsageRows,
  ceilCredits,
  summarizeAiUsageByModel,
  usdPerCredit,
} from "./credits-pricing.service.js";

function models() {
  const s = getSequelize();
  if (!s) throw new Error("Database not available");
  return s.models;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Date} [date]
 * @returns {string} YYYY-MM (UTC)
 */
export function currentPeriodMonth(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * @param {string} tenantId
 * @param {string} [periodMonth]
 * @returns {Promise<number>}
 */
async function sumFreeUsedForPeriod(tenantId, periodMonth) {
  const { TenantCreditLedger } = models();
  const rows = await TenantCreditLedger.findAll({
    where: { tenantId, periodMonth },
    attributes: ["creditsFromFree"],
  });
  let sum = 0;
  for (const r of rows) {
    sum += safeNumber(r.get("creditsFromFree"));
  }
  return ceilCredits(sum);
}

/**
 * @param {string} tenantId
 * @returns {Promise<{
 *   usdPerCredit: number,
 *   monthlyFreeCredits: number,
 *   freeUsedThisMonth: number,
 *   freeRemaining: number,
 *   purchasedCredits: number,
 *   totalRemaining: number,
 *   periodMonth: string,
 *   limiterActive: boolean,
 * } | null>}
 */
export async function getTenantCreditState(tenantId) {
  const { Tenant } = models();
  const id = String(tenantId || "").trim();
  if (!id) return null;
  const row = await Tenant.findByPk(id);
  if (!row) return null;

  const periodMonth = currentPeriodMonth();
  const monthlyFreeCredits = Math.max(0, Math.floor(safeNumber(row.get("monthlyFreeCredits"))));
  const purchasedCredits = Math.max(0, ceilCredits(safeNumber(row.get("purchasedCredits"))));
  const freeUsedThisMonth = await sumFreeUsedForPeriod(id, periodMonth);
  const freeRemaining = Math.max(0, monthlyFreeCredits - freeUsedThisMonth);
  const totalRemaining = Math.max(0, freeRemaining + purchasedCredits);
  // Limiter is inactive when both pools are 0 (legacy / not configured) so we don't block all tenants.
  const limiterActive = monthlyFreeCredits > 0 || purchasedCredits > 0;

  return {
    usdPerCredit: usdPerCredit(),
    monthlyFreeCredits,
    freeUsedThisMonth,
    freeRemaining,
    purchasedCredits,
    totalRemaining,
    periodMonth,
    limiterActive,
  };
}

/**
 * Throw when the tenant has no remaining credits and the limiter is active.
 *
 * @param {string} tenantId
 */
export async function assertTenantHasCredits(tenantId) {
  const state = await getTenantCreditState(tenantId);
  if (!state) throw new Error("Tenant not found");
  if (!state.limiterActive) return state;
  if (state.totalRemaining <= 0) {
    const err = new Error("No credits remaining for this tenant");
    /** @type {Error & { code?: string, status?: number }} */ (err).code = "NO_CREDITS";
    /** @type {Error & { code?: string, status?: number }} */ (err).status = 402;
    throw err;
  }
  return state;
}

/**
 * Allocate credits for a job: consume monthly free first, then purchased.
 *
 * @param {number} totalCredits
 * @param {number} freeRemaining
 * @returns {{ fromFree: number, fromPurchased: number }}
 */
function allocateCredits(totalCredits, freeRemaining) {
  const total = Math.max(0, ceilCredits(totalCredits));
  const freeCap = Math.max(0, ceilCredits(freeRemaining));
  const fromFree = Math.min(total, freeCap);
  const fromPurchased = Math.max(0, total - fromFree);
  return { fromFree, fromPurchased };
}

/**
 * Recalculate ledger rows for a job from its openaiClipUsage + ttsClipUsage, and adjust
 * tenants.purchased_credits by the purchased-credit delta (idempotent).
 *
 * @param {string} jobId
 * @returns {Promise<{ ok: boolean, reason?: string, credits?: number }>}
 */
export async function reconcileJobCredits(jobId) {
  const id = String(jobId || "").trim();
  if (!id) return { ok: false, reason: "missing_job_id" };

  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: "db_unavailable" };

  const job = await getJob(id);
  if (!job) return { ok: false, reason: "job_not_found" };

  const tenantId = String(job.tenantId || "").trim();
  if (!tenantId) return { ok: false, reason: "missing_tenant" };

  const usageRows = summarizeAiUsageByModel(
    /** @type {Record<string, unknown> | null | undefined} */ (job.openaiClipUsage),
    /** @type {Record<string, unknown> | null | undefined} */ (job.ttsClipUsage),
  );
  const agg = aggregateUsageRows(usageRows);
  const periodMonth = currentPeriodMonth(
    job.createdAt ? new Date(job.createdAt) : new Date(),
  );

  const { Tenant, TenantCreditLedger } = models();

  await sequelize.transaction(async (transaction) => {
    const existing = await TenantCreditLedger.findAll({
      where: { jobId: id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    let previousPurchased = 0;
    for (const r of existing) {
      previousPurchased += safeNumber(r.get("creditsFromPurchased"));
    }
    previousPurchased = ceilCredits(previousPurchased);

    if (existing.length) {
      await TenantCreditLedger.destroy({ where: { jobId: id }, transaction });
    }

    // Free used by other jobs this period (this job's rows were destroyed above).
    const otherFreeRows = await TenantCreditLedger.findAll({
      where: { tenantId, periodMonth },
      attributes: ["creditsFromFree"],
      transaction,
    });
    let freeUsedOthers = 0;
    for (const r of otherFreeRows) {
      freeUsedOthers += safeNumber(r.get("creditsFromFree"));
    }
    freeUsedOthers = ceilCredits(freeUsedOthers);

    const tenantRow = await Tenant.findByPk(tenantId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!tenantRow) return;

    const monthlyFree = Math.max(0, Math.floor(safeNumber(tenantRow.get("monthlyFreeCredits"))));
    const freeRemaining = Math.max(0, monthlyFree - freeUsedOthers);
    const { fromFree, fromPurchased } = allocateCredits(agg.totalCredits, freeRemaining);

    // Adjust purchased balance by delta vs previous reconciliation for this job.
    const purchasedDelta = fromPurchased - previousPurchased;
    if (purchasedDelta !== 0) {
      const currentPurchased = Math.max(0, ceilCredits(safeNumber(tenantRow.get("purchasedCredits"))));
      const nextPurchased = Math.max(0, currentPurchased - purchasedDelta);
      tenantRow.purchasedCredits = nextPurchased;
      await tenantRow.save({ transaction });
    }

    if (usageRows.length === 0 || agg.totalCredits <= 0) {
      return;
    }

    // Proportionally split free/purchased across usage rows.
    let remainingFree = fromFree;
    let remainingPurchased = fromPurchased;
    const now = new Date();
    for (let i = 0; i < usageRows.length; i++) {
      const row = usageRows[i];
      const isLast = i === usageRows.length - 1;
      let rowFromFree;
      let rowFromPurchased;
      if (isLast) {
        rowFromFree = remainingFree;
        rowFromPurchased = remainingPurchased;
      } else {
        const share = agg.totalCredits > 0 ? safeNumber(row.credits) / agg.totalCredits : 0;
        rowFromFree = ceilCredits(fromFree * share);
        rowFromPurchased = ceilCredits(fromPurchased * share);
        // Keep remainder non-negative; last row absorbs leftovers.
        if (rowFromFree > remainingFree) rowFromFree = remainingFree;
        if (rowFromPurchased > remainingPurchased) rowFromPurchased = remainingPurchased;
        remainingFree = Math.max(0, remainingFree - rowFromFree);
        remainingPurchased = Math.max(0, remainingPurchased - rowFromPurchased);
      }

      await TenantCreditLedger.create(
        {
          id: crypto.randomUUID(),
          tenantId,
          periodMonth,
          jobId: id,
          category: row.category,
          model: row.model,
          units: row.units,
          unitKind: row.unitKind,
          usd: row.usd,
          credits: row.credits,
          creditsFromFree: Math.max(0, rowFromFree),
          creditsFromPurchased: Math.max(0, rowFromPurchased),
          createdAt: now,
        },
        { transaction },
      );
    }
  });

  return { ok: true, credits: agg.totalCredits };
}

/**
 * Aggregate ledger rows for a tenant period (dashboard tables).
 *
 * @param {string} tenantId
 * @param {string} [periodMonth]
 */
export async function getLedgerUsageByModelForPeriod(tenantId, periodMonth) {
  const { TenantCreditLedger } = models();
  const id = String(tenantId || "").trim();
  const month = periodMonth || currentPeriodMonth();
  if (!id) return [];

  const rows = await TenantCreditLedger.findAll({
    where: { tenantId: id, periodMonth: month },
    order: [["createdAt", "ASC"]],
  });

  /** @type {Map<string, { category: string, model: string, units: number, unitKind: string, totalUsd: number, credits: number }>} */
  const map = new Map();
  for (const r of rows) {
    const category = String(r.get("category") || "");
    const model = String(r.get("model") || "");
    const unitKind = String(r.get("unitKind") || "tokens");
    const key = `${category}::${model}::${unitKind}`;
    const prev = map.get(key) || {
      category,
      model,
      units: 0,
      unitKind,
      totalUsd: 0,
      credits: 0,
    };
    prev.units += safeNumber(r.get("units"));
    prev.totalUsd += safeNumber(r.get("usd"));
    prev.credits += safeNumber(r.get("credits"));
    map.set(key, prev);
  }

  return Array.from(map.values()).map((row) => {
    const units = Math.round(row.units * 10000) / 10000;
    const totalUsd = Math.round(row.totalUsd * 1e6) / 1e6;
    const credits = ceilCredits(row.credits);
    return {
      category: row.category,
      model: row.model,
      units,
      unitKind: row.unitKind,
      approxUsdPerUnit: units > 0 ? Math.round((totalUsd / units) * 1e6) / 1e6 : 0,
      totalUsd,
      credits,
    };
  });
}

/**
 * Fallback: build usage from jobs' openaiClipUsage/ttsClipUsage when ledger is empty
 * (e.g. historical months before credits existed).
 *
 * @param {Array<{ openaiClipUsage?: unknown, ttsClipUsage?: unknown }>} jobs
 */
export function summarizeJobsAiUsage(jobs) {
  /** @type {Map<string, { category: string, model: string, units: number, unitKind: string, totalUsd: number, credits: number }>} */
  const map = new Map();
  for (const j of jobs || []) {
    const rows = summarizeAiUsageByModel(
      /** @type {Record<string, unknown> | null | undefined} */ (j.openaiClipUsage),
      /** @type {Record<string, unknown> | null | undefined} */ (j.ttsClipUsage),
    );
    for (const row of rows) {
      const key = `${row.category}::${row.model}::${row.unitKind}`;
      const prev = map.get(key) || {
        category: row.category,
        model: row.model,
        units: 0,
        unitKind: row.unitKind,
        totalUsd: 0,
        credits: 0,
      };
      prev.units += row.units;
      prev.totalUsd += row.usd;
      prev.credits += row.credits;
      map.set(key, prev);
    }
  }
  return Array.from(map.values()).map((row) => {
    const units = Math.round(row.units * 10000) / 10000;
    const totalUsd = Math.round(row.totalUsd * 1e6) / 1e6;
    const credits = ceilCredits(row.credits);
    return {
      category: row.category,
      model: row.model,
      units,
      unitKind: row.unitKind,
      approxUsdPerUnit: units > 0 ? Math.round((totalUsd / units) * 1e6) / 1e6 : 0,
      totalUsd,
      credits,
    };
  });
}
