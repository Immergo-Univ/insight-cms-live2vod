import jwt from "jsonwebtoken";
import { config } from "../config.js";

function readBearer(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return "";
}

/**
 * Verifies JWT and sets `req.adminUserId`, `req.adminUserEmail`.
 */
export function adminJwtMiddleware(req, res, next) {
  if (!config.admin.jwtSecret) {
    return res.status(503).json({ error: "Admin auth is not configured (JWT_SECRET)" });
  }
  const token = readBearer(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, config.admin.jwtSecret);
    req.adminUserId = payload.sub;
    req.adminUserEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
