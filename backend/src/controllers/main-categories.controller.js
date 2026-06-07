import { Router } from "express";
import { fetchMainCategories, mapMainCategoryData } from "../services/main-categories.service.js";
import { resolveTenant } from "../services/auth.service.js";

export const mainCategoriesRouter = Router();

mainCategoriesRouter.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.headers["x-tenant-id"];

    if (!tenantId) {
      return res.status(400).json({
        error: "Missing required query parameter: tenantId",
      });
    }

    const { accountId } = await resolveTenant(tenantId);

    console.log(`[main-categories] tenantId="${tenantId}" → accountId="${accountId}"`);

    const rawRows = await fetchMainCategories({ accountId, tenantId });
    const rows = rawRows.map(mapMainCategoryData).filter((row) => row.id);

    console.log(`[main-categories] fetched ${rawRows.length} raw row(s), returning ${rows.length} mapped row(s)`);

    res.json(rows);
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || error.message;
    res.status(status).json({ error: message });
  }
});
