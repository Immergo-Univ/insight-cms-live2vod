import { adminUserHasPermission } from "../services/admin-permission-check.service.js";

/**
 * @param {string} entity
 * @param {string} action
 */
export function requireAdminPermission(entity, action) {
  return async (req, res, next) => {
    try {
      const ok = await adminUserHasPermission(req.adminUserId, entity, action);
      if (!ok) return res.status(403).json({ error: "Forbidden" });
      next();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: m });
    }
  };
}
