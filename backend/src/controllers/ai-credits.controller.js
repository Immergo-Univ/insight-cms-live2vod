import { Router } from "express";
import { resolveTenant } from "../services/auth.service.js";
import { getTenantCreditState } from "../services/tenant-credits.service.js";
import {
  cancelTenantOrder,
  createTenantOrder,
  getCreditCatalog,
  listTenantOrders,
} from "../services/credit-purchase-orders.service.js";
import { isSequelizeReady } from "../db/sequelize.js";
import { getRequestTenantId } from "../utils/tenant-cipher.js";

export const aiCreditsRouter = Router();

/**
 * @param {import("express").Response} res
 * @param {unknown} e
 */
function sendError(res, e) {
  const message = e instanceof Error ? e.message : String(e);
  const status = e && typeof e === "object" && "status" in e ? Number(/** @type {{ status?: number }} */ (e).status) || 400 : 400;
  const code = e && typeof e === "object" && "code" in e ? String(/** @type {{ code?: string }} */ (e).code || "") : "";
  res.status(status).json({ error: message, ...(code ? { code } : {}) });
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns {Promise<string | null>}
 */
async function requireTenant(req, res) {
  const tenantId = getRequestTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: "Missing tenantId (query or x-tenant-id header)" });
    return null;
  }
  if (!isSequelizeReady()) {
    res.status(503).json({ error: "Credits require PostgreSQL to be configured" });
    return null;
  }
  await resolveTenant(tenantId);
  return tenantId;
}

/**
 * Balance, catalog (packs / custom / per-minute rates) and the tenant's recent orders.
 * GET /api/ai-credits
 */
aiCreditsRouter.get("/", async (req, res) => {
  try {
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;
    const [credits, orders] = await Promise.all([getTenantCreditState(tenantId), listTenantOrders(tenantId, 10)]);
    res.json({ tenantId, credits, catalog: getCreditCatalog(), orders });
  } catch (e) {
    sendError(res, e);
  }
});

/**
 * Create a purchase order (pending admin approval).
 * POST /api/ai-credits/orders  body: { kind, packId?, credits?, invoiceDetails?, contactDetails?, vodGuid? }
 */
aiCreditsRouter.post("/orders", async (req, res) => {
  try {
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;
    const order = await createTenantOrder(tenantId, req.body && typeof req.body === "object" ? req.body : {});
    res.status(201).json({ order });
  } catch (e) {
    sendError(res, e);
  }
});

/**
 * Cancel one of the tenant's pending orders.
 * POST /api/ai-credits/orders/:orderId/cancel
 */
aiCreditsRouter.post("/orders/:orderId/cancel", async (req, res) => {
  try {
    const tenantId = await requireTenant(req, res);
    if (!tenantId) return;
    const order = await cancelTenantOrder(tenantId, req.params.orderId);
    res.json({ order });
  } catch (e) {
    sendError(res, e);
  }
});
