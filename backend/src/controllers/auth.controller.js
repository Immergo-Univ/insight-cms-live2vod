import { Router } from "express";
import {
  resolveTenant,
  getSessionAccounts,
  getSessionCustomers,
} from "../services/auth.service.js";

export const authRouter = Router();

authRouter.get("/context", async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.headers["x-tenant-id"];

    if (!tenantId) {
      return res.status(400).json({
        error: "Missing required query parameter: tenantId",
      });
    }

    const { accountId, customerId } = await resolveTenant(tenantId);
    const accounts = await getSessionAccounts();
    const customers = await getSessionCustomers();

    res.json({ tenantId, customerId, accountId, accounts, customers });
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || error.message;
    res.status(status).json({ error: message });
  }
});
