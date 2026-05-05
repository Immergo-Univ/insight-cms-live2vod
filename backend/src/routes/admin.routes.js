import { Router } from "express";
import { adminJwtMiddleware } from "../middleware/admin-jwt.middleware.js";
import { requireAdminPermission } from "../middleware/admin-permission.middleware.js";
import { adminLogin, adminMe } from "../services/admin-auth.service.js";
import { adminGetPermissionMapForUser } from "../services/admin-permission-map.service.js";
import * as users from "../services/admin-user.service.js";
import * as roles from "../services/admin-role.service.js";
import * as matrix from "../services/admin-matrix.service.js";
import * as clips from "../services/admin-clip.service.js";
import { isSequelizeReady } from "../db/sequelize.js";

export const adminRouter = Router();

function requireDb(req, res, next) {
  if (!isSequelizeReady()) return res.status(503).json({ error: "Admin requires PostgreSQL to be configured and connected" });
  next();
}

adminRouter.post("/auth/login", requireDb, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const out = await adminLogin(email, password);
    res.json(out);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const code = m.includes("not configured") ? 503 : 401;
    res.status(code).json({ error: m });
  }
});

const adminSecured = Router();
adminSecured.use(requireDb);
adminSecured.use(adminJwtMiddleware);

adminSecured.get("/auth/me", async (req, res) => {
  try {
    const me = await adminMe(req.adminUserId);
    if (!me) return res.status(404).json({ error: "User not found" });
    res.json(me);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.get("/auth/permissions", async (req, res) => {
  try {
    const permissions = await adminGetPermissionMapForUser(req.adminUserId);
    res.json({ permissions });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.patch("/auth/profile", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { password, displayName, language, avatarUrl } = body;
    const patch = {};
    if (displayName !== undefined) patch.displayName = displayName;
    if (language !== undefined) patch.language = language;
    if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl;
    if (password) patch.password = password;
    const row = await users.adminUpdateUser(req.adminUserId, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.get("/users", requireAdminPermission("users", "view"), async (_req, res) => {
  try {
    res.json({ users: await users.adminListUsers() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.get("/users/:id", requireAdminPermission("users", "view"), async (req, res) => {
  try {
    const row = await users.adminGetUser(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.post("/users", requireAdminPermission("users", "create"), async (req, res) => {
  try {
    const row = await users.adminCreateUser(req.body || {}, req.adminUserId);
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.patch("/users/:id", requireAdminPermission("users", "edit"), async (req, res) => {
  try {
    const row = await users.adminUpdateUser(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.delete("/users/:id", requireAdminPermission("users", "delete"), async (req, res) => {
  try {
    if (req.params.id === req.adminUserId) return res.status(400).json({ error: "Cannot delete your own account" });
    const ok = await users.adminDeleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.get("/roles", requireAdminPermission("roles", "view"), async (_req, res) => {
  try {
    res.json({ roles: await roles.adminListRoles() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.post("/roles", requireAdminPermission("roles", "create"), async (req, res) => {
  try {
    const row = await roles.adminCreateRole(req.body || {});
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.patch("/roles/:id", requireAdminPermission("roles", "edit"), async (req, res) => {
  try {
    const row = await roles.adminUpdateRole(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.delete("/roles/:id", requireAdminPermission("roles", "delete"), async (req, res) => {
  try {
    await roles.adminDeleteRole(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.get("/permissions/matrix", requireAdminPermission("permissions", "view"), async (req, res) => {
  try {
    const roleId = String(req.query.roleId || "").trim();
    if (!roleId) return res.status(400).json({ error: "roleId query required" });
    res.json(await matrix.adminGetPermissionMatrix(roleId));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.put("/permissions/matrix", requireAdminPermission("permissions", "edit"), async (req, res) => {
  try {
    const { roleId, matrix: m } = req.body || {};
    if (!roleId || !m || typeof m !== "object") return res.status(400).json({ error: "roleId and matrix required" });
    res.json(await matrix.adminSavePermissionMatrix(roleId, m));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.get("/clips", requireAdminPermission("clips", "view"), async (req, res) => {
  try {
    const page = parseInt(String(req.query.page || "1"), 10);
    const pageSize = parseInt(String(req.query.pageSize || "20"), 10);
    const tenantId = String(req.query.tenantId || "").trim() || undefined;
    const status = String(req.query.status || "").trim() || undefined;
    res.json(await clips.adminListClips({ page, pageSize, tenantId, status }));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminSecured.get("/clips/:id", requireAdminPermission("clips", "view"), async (req, res) => {
  try {
    const row = await clips.adminGetClipFull(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminRouter.use(adminSecured);
