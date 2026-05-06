import { Router } from "express";
import { ensureTenantVisited, getTenantById } from "../services/tenant-visit.service.js";
import {
  getSyndicationStatusForTenant,
  mockAuthorizeYoutubeSyndication,
} from "../services/tenant-syndication.service.js";

export const tenantsRouter = Router();

tenantsRouter.post("/ensure", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const tenantId = body.tenantId;
    const timezone = body.tz ?? body.timezone;
    const metadata = body.metadata;
    const tenant = await ensureTenantVisited({ tenantId, timezone, metadata });
    res.json({ tenant });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 400;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId/syndication", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await getSyndicationStatusForTenant(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 500;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.post("/:tenantId/syndication/youtube/mock-authorize", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const status = await mockAuthorizeYoutubeSyndication(tenantId);
    if (!status) return res.status(404).json({ error: "Tenant not found" });
    res.json(status);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not available") ? 503 : 500;
    res.status(code).json({ error: m });
  }
});

tenantsRouter.get("/:tenantId", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    res.json({ tenant });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: m });
  }
});
