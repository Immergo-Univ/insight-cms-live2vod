import crypto from "crypto";
import { Op } from "sequelize";
import { getSequelize } from "../db/sequelize.js";
import { getTenantCreditState } from "./tenant-credits.service.js";
import { aiServiceCreditsPerMinute } from "./credits-pricing.service.js";

/** Sale value of one credit (USD) for custom amounts. Override with CREDIT_SALE_USD_VALUE. */
const DEFAULT_SALE_USD_PER_CREDIT = 0.005;
/** Minimum credits for a custom amount. Override with CREDIT_CUSTOM_MIN. */
const DEFAULT_CUSTOM_MIN_CREDITS = 20000;
const MAX_CUSTOM_CREDITS = 10_000_000;
/** Max open (pending) orders per tenant, to avoid accidental duplicates. */
const MAX_PENDING_ORDERS_PER_TENANT = 5;
const DEFAULT_SALES_EMAIL = "support-immergo@immergo.tv";

/**
 * Default packs. Override with CREDIT_PACKS_JSON (array of { id, name, priceUsd, credits, badge? }).
 * `badge` is an i18n key on the frontend: "mostPopular" | "bestValue".
 */
const DEFAULT_PACKS = [
  { id: "starter", name: "Starter", priceUsd: 100, credits: 20000 },
  { id: "pro", name: "Pro", priceUsd: 500, credits: 110000, badge: "mostPopular" },
  { id: "business", name: "Business", priceUsd: 1000, credits: 250000, badge: "bestValue" },
];

export const ORDER_KINDS = ["pack", "custom", "enterprise"];
export const ORDER_STATUSES = ["pending", "approved", "rejected", "cancelled"];
const CONTACT_NEEDS = ["stt", "subtitles", "article", "dubbing"];
const CONTACT_REACH = ["email", "phone", "video"];

/**
 * @param {number} status
 * @param {string} message
 * @param {string} [code]
 */
function httpError(status, message, code) {
  const err = /** @type {Error & { status?: number, code?: string }} */ (new Error(message));
  err.status = status;
  if (code) err.code = code;
  return err;
}

function models() {
  const s = getSequelize();
  if (!s) throw httpError(503, "Database not available");
  return s.models;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n) {
  return Math.round(safeNumber(n) * 100) / 100;
}

/**
 * @param {unknown} v
 * @param {number} max
 */
function cleanText(v, max) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

export function saleUsdPerCredit() {
  const n = Number(String(process.env.CREDIT_SALE_USD_VALUE || "").trim());
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SALE_USD_PER_CREDIT;
}

function customMinCredits() {
  const n = Number(String(process.env.CREDIT_CUSTOM_MIN || "").trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CUSTOM_MIN_CREDITS;
}

/**
 * @returns {Array<{ id: string, name: string, priceUsd: number, credits: number, badge: string | null }>}
 */
function loadPacks() {
  const raw = String(process.env.CREDIT_PACKS_JSON || "").trim();
  let list = DEFAULT_PACKS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) list = parsed;
    } catch {
      console.warn("[credit-orders] CREDIT_PACKS_JSON is not valid JSON; using default packs");
    }
  }
  return list
    .map((p) => ({
      id: cleanText(p?.id, 32),
      name: cleanText(p?.name, 64),
      priceUsd: roundMoney(p?.priceUsd),
      credits: Math.floor(safeNumber(p?.credits)),
      badge: p?.badge ? cleanText(p.badge, 32) : null,
    }))
    .filter((p) => p.id && p.name && p.credits > 0 && p.priceUsd > 0);
}

/**
 * Packs, custom pricing and AI per-minute rates shown in the Buy credits dialog.
 */
export function getCreditCatalog() {
  const usd = saleUsdPerCredit();
  const packs = loadPacks().map((p) => {
    const listPrice = p.credits * usd;
    const savePercent = listPrice > 0 ? Math.round((1 - p.priceUsd / listPrice) * 100) : 0;
    return { ...p, savePercent: savePercent > 0 ? savePercent : 0 };
  });
  const enterpriseFromCredits = packs.reduce((max, p) => Math.max(max, p.credits), 0);
  return {
    packs,
    custom: { minCredits: customMinCredits(), maxCredits: MAX_CUSTOM_CREDITS, usdPerCredit: usd },
    enterpriseFromCredits,
    salesEmail: String(process.env.CREDIT_SALES_EMAIL || "").trim() || DEFAULT_SALES_EMAIL,
    creditsPerMinute: aiServiceCreditsPerMinute(),
  };
}

/**
 * @param {import("sequelize").Model | null | undefined} row
 */
export function serializeOrder(row) {
  if (!row) return null;
  const o = row.get({ plain: true });
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    tenantId: o.tenantId,
    kind: o.kind,
    packId: o.packId ?? null,
    packName: o.packName ?? null,
    credits: Math.floor(safeNumber(o.credits)),
    priceUsd: roundMoney(o.priceUsd),
    status: o.status,
    vodGuid: o.vodGuid ?? null,
    invoiceDetails: o.invoiceDetails ?? null,
    contactDetails: o.contactDetails ?? null,
    balanceAtRequest: o.balanceAtRequest ?? null,
    adminNotes: o.adminNotes ?? null,
    rejectReason: o.rejectReason ?? null,
    createdByAdminId: o.createdByAdminId ?? null,
    reviewedByAdminId: o.reviewedByAdminId ?? null,
    reviewedAt: o.reviewedAt ? new Date(o.reviewedAt).toISOString() : null,
    createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : null,
    updatedAt: o.updatedAt ? new Date(o.updatedAt).toISOString() : null,
  };
}

/**
 * @param {unknown} raw
 * @returns {{ companyName: string, taxId: string, billingEmail: string } | null}
 */
function normalizeInvoiceDetails(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const out = {
    companyName: cleanText(o.companyName, 200),
    taxId: cleanText(o.taxId, 64),
    billingEmail: cleanText(o.billingEmail, 200),
  };
  if (out.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.billingEmail)) {
    throw httpError(400, "Invalid billing email", "INVALID_EMAIL");
  }
  return out.companyName || out.taxId || out.billingEmail ? out : null;
}

/**
 * @param {unknown} raw
 */
function normalizeContactDetails(raw) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
  const needs = Array.isArray(o.needs)
    ? [...new Set(o.needs.map((n) => String(n || "").trim()).filter((n) => CONTACT_NEEDS.includes(n)))]
    : [];
  const reachBy = CONTACT_REACH.includes(String(o.reachBy || "")) ? String(o.reachBy) : "email";
  return {
    monthlyVolume: cleanText(o.monthlyVolume, 64),
    billingPreference: cleanText(o.billingPreference, 64),
    needs,
    message: cleanText(o.message, 4000),
    reachBy,
    contactName: cleanText(o.contactName, 200),
    contactEmail: cleanText(o.contactEmail, 200),
    contactPhone: cleanText(o.contactPhone, 64),
  };
}

/**
 * Create a purchase order from the tenant AI page. Credits are NOT granted until an admin approves it.
 *
 * @param {string} tenantId
 * @param {Record<string, unknown>} body { kind, packId?, credits?, invoiceDetails?, contactDetails?, vodGuid? }
 */
export async function createTenantOrder(tenantId, body) {
  const { CreditPurchaseOrder } = models();
  const tid = String(tenantId || "").trim();
  if (!tid) throw httpError(400, "Missing tenantId");

  const kind = String(body?.kind || "").trim();
  if (!ORDER_KINDS.includes(kind)) throw httpError(400, "Invalid order kind", "INVALID_KIND");

  const pending = await CreditPurchaseOrder.count({ where: { tenantId: tid, status: "pending" } });
  if (pending >= MAX_PENDING_ORDERS_PER_TENANT) {
    throw httpError(409, "Too many pending orders for this tenant", "TOO_MANY_PENDING");
  }

  const catalog = getCreditCatalog();
  /** @type {Record<string, unknown>} */
  const values = {
    id: crypto.randomUUID(),
    tenantId: tid,
    kind,
    status: "pending",
    vodGuid: cleanText(body?.vodGuid, 128) || null,
    invoiceDetails: normalizeInvoiceDetails(body?.invoiceDetails),
  };

  if (kind === "pack") {
    const pack = catalog.packs.find((p) => p.id === String(body?.packId || ""));
    if (!pack) throw httpError(400, "Unknown credit pack", "INVALID_PACK");
    values.packId = pack.id;
    values.packName = pack.name;
    values.credits = pack.credits;
    values.priceUsd = pack.priceUsd;
  } else if (kind === "custom") {
    const credits = Math.floor(safeNumber(body?.credits));
    if (credits < catalog.custom.minCredits || credits > catalog.custom.maxCredits) {
      throw httpError(400, `Custom amount must be between ${catalog.custom.minCredits} and ${catalog.custom.maxCredits} credits`, "INVALID_CREDITS");
    }
    values.credits = credits;
    values.priceUsd = roundMoney(credits * catalog.custom.usdPerCredit);
  } else {
    values.credits = 0;
    values.priceUsd = 0;
    values.contactDetails = normalizeContactDetails(body?.contactDetails);
  }

  const state = await getTenantCreditState(tid).catch(() => null);
  values.balanceAtRequest = state ? state.totalRemaining : null;

  const row = await CreditPurchaseOrder.create(values);
  console.log(`[credit-orders] created order=${row.get("id")} tenant=${tid} kind=${kind} credits=${values.credits}`);
  return serializeOrder(row);
}

/**
 * @param {string} tenantId
 * @param {number} [limit]
 */
export async function listTenantOrders(tenantId, limit = 10) {
  const { CreditPurchaseOrder } = models();
  const rows = await CreditPurchaseOrder.findAll({
    where: { tenantId: String(tenantId || "").trim() },
    order: [["createdAt", "DESC"]],
    limit: Math.min(50, Math.max(1, limit)),
  });
  return rows.map(serializeOrder);
}

/**
 * Tenant cancels its own pending order.
 * @param {string} tenantId
 * @param {string} orderId
 */
export async function cancelTenantOrder(tenantId, orderId) {
  const { CreditPurchaseOrder } = models();
  const row = await CreditPurchaseOrder.findByPk(String(orderId || ""));
  if (!row || row.get("tenantId") !== String(tenantId || "").trim()) throw httpError(404, "Order not found");
  if (row.get("status") !== "pending") throw httpError(409, "Only pending orders can be cancelled", "NOT_PENDING");
  row.set("status", "cancelled");
  await row.save();
  return serializeOrder(row);
}

/**
 * @param {{ status?: string, tenantId?: string, kind?: string, page?: number, pageSize?: number }} opts
 */
export async function adminListOrders(opts = {}) {
  const { CreditPurchaseOrder } = models();
  /** @type {Record<string, unknown>} */
  const where = {};
  if (opts.status && ORDER_STATUSES.includes(opts.status)) where.status = opts.status;
  if (opts.kind && ORDER_KINDS.includes(opts.kind)) where.kind = opts.kind;
  if (opts.tenantId) where.tenantId = { [Op.iLike]: `%${String(opts.tenantId).trim()}%` };
  const page = Math.max(1, Math.floor(safeNumber(opts.page) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(safeNumber(opts.pageSize) || 20)));
  const { rows, count } = await CreditPurchaseOrder.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const pendingCount = await CreditPurchaseOrder.count({ where: { status: "pending" } });
  return { items: rows.map(serializeOrder), total: count, page, pageSize, pendingCount };
}

/** @param {string} id */
export async function adminGetOrder(id) {
  const { CreditPurchaseOrder } = models();
  const row = await CreditPurchaseOrder.findByPk(String(id || ""));
  if (!row) return null;
  const order = serializeOrder(row);
  const credits = await getTenantCreditState(order.tenantId).catch(() => null);
  return { ...order, tenantCredits: credits };
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} adminUserId
 */
export async function adminCreateOrder(body, adminUserId) {
  const { CreditPurchaseOrder, Tenant } = models();
  const tenantId = cleanText(body?.tenantId, 128);
  if (!tenantId) throw httpError(400, "tenantId is required");
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw httpError(404, "Tenant not found");
  const kind = ORDER_KINDS.includes(String(body?.kind)) ? String(body.kind) : "custom";
  const credits = Math.floor(safeNumber(body?.credits));
  if (credits <= 0 || credits > MAX_CUSTOM_CREDITS) throw httpError(400, "credits must be a positive integer");
  const priceUsd = roundMoney(body?.priceUsd);
  if (priceUsd < 0) throw httpError(400, "priceUsd must be >= 0");
  const state = await getTenantCreditState(tenantId).catch(() => null);
  const row = await CreditPurchaseOrder.create({
    id: crypto.randomUUID(),
    tenantId,
    kind,
    packId: cleanText(body?.packId, 32) || null,
    packName: cleanText(body?.packName, 64) || null,
    credits,
    priceUsd,
    status: "pending",
    invoiceDetails: normalizeInvoiceDetails(body?.invoiceDetails),
    adminNotes: cleanText(body?.adminNotes, 4000) || null,
    balanceAtRequest: state ? state.totalRemaining : null,
    createdByAdminId: adminUserId || null,
  });
  return serializeOrder(row);
}

/**
 * Edit a pending order (credits, price, notes, invoice details).
 * @param {string} id
 * @param {Record<string, unknown>} body
 */
export async function adminUpdateOrder(id, body) {
  const { CreditPurchaseOrder } = models();
  const row = await CreditPurchaseOrder.findByPk(String(id || ""));
  if (!row) return null;
  if (row.get("status") !== "pending") throw httpError(409, "Only pending orders can be edited", "NOT_PENDING");
  if (body.credits !== undefined) {
    const credits = Math.floor(safeNumber(body.credits));
    if (credits < 0 || credits > MAX_CUSTOM_CREDITS) throw httpError(400, "credits must be an integer >= 0");
    row.set("credits", credits);
  }
  if (body.priceUsd !== undefined) {
    const price = roundMoney(body.priceUsd);
    if (price < 0) throw httpError(400, "priceUsd must be >= 0");
    row.set("priceUsd", price);
  }
  if (body.packName !== undefined) row.set("packName", cleanText(body.packName, 64) || null);
  if (body.adminNotes !== undefined) row.set("adminNotes", cleanText(body.adminNotes, 4000) || null);
  if (body.invoiceDetails !== undefined) row.set("invoiceDetails", normalizeInvoiceDetails(body.invoiceDetails));
  await row.save();
  return serializeOrder(row);
}

/**
 * Approve a pending order and add its credits to the tenant's purchased pool (atomic).
 * @param {string} id
 * @param {string} adminUserId
 * @param {{ adminNotes?: string }} [opts]
 */
export async function adminApproveOrder(id, adminUserId, opts = {}) {
  const sequelize = getSequelize();
  if (!sequelize) throw httpError(503, "Database not available");
  const { CreditPurchaseOrder, Tenant } = sequelize.models;

  const result = await sequelize.transaction(async (transaction) => {
    const row = await CreditPurchaseOrder.findByPk(String(id || ""), { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) return null;
    if (row.get("status") !== "pending") throw httpError(409, "Only pending orders can be approved", "NOT_PENDING");
    const credits = Math.floor(safeNumber(row.get("credits")));
    if (credits <= 0) throw httpError(400, "Set the number of credits before approving this order", "NO_CREDITS_SET");

    const tenant = await Tenant.findByPk(row.get("tenantId"), { transaction, lock: transaction.LOCK.UPDATE });
    if (!tenant) throw httpError(404, "Tenant not found");
    const current = Math.max(0, Math.floor(safeNumber(tenant.get("purchasedCredits"))));
    tenant.set("purchasedCredits", current + credits);
    await tenant.save({ transaction });

    row.set("status", "approved");
    row.set("reviewedByAdminId", adminUserId || null);
    row.set("reviewedAt", new Date());
    if (opts.adminNotes !== undefined) row.set("adminNotes", cleanText(opts.adminNotes, 4000) || null);
    await row.save({ transaction });
    return row;
  });

  if (!result) return null;
  console.log(
    `[credit-orders] approved order=${result.get("id")} tenant=${result.get("tenantId")} credits=${result.get("credits")} by=${adminUserId}`,
  );
  return serializeOrder(result);
}

/**
 * @param {string} id
 * @param {string} adminUserId
 * @param {{ reason?: string }} [opts]
 */
export async function adminRejectOrder(id, adminUserId, opts = {}) {
  const { CreditPurchaseOrder } = models();
  const row = await CreditPurchaseOrder.findByPk(String(id || ""));
  if (!row) return null;
  if (row.get("status") !== "pending") throw httpError(409, "Only pending orders can be rejected", "NOT_PENDING");
  row.set("status", "rejected");
  row.set("rejectReason", cleanText(opts.reason, 2000) || null);
  row.set("reviewedByAdminId", adminUserId || null);
  row.set("reviewedAt", new Date());
  await row.save();
  return serializeOrder(row);
}

/**
 * Approved orders are kept as the audit trail of granted credits and cannot be deleted.
 * @param {string} id
 */
export async function adminDeleteOrder(id) {
  const { CreditPurchaseOrder } = models();
  const row = await CreditPurchaseOrder.findByPk(String(id || ""));
  if (!row) return false;
  if (row.get("status") === "approved") throw httpError(409, "Approved orders cannot be deleted", "APPROVED");
  await row.destroy();
  return true;
}
