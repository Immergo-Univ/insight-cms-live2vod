/**
 * Shared-secret authentication. Accepts the secret via `x-api-secret` header, `Authorization:
 * Bearer <secret>` or `?secret=` query param. Disabled when config.apiSecret is empty.
 */

import { config } from "../config.js";

export function requireSecret(req, res, next) {
  if (!config.apiSecret) return next(); // auth disabled

  const header = req.get("x-api-secret");
  const auth = req.get("authorization");
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : null;
  const query = typeof req.query.secret === "string" ? req.query.secret : null;

  const provided = header || bearer || query;
  if (provided && provided === config.apiSecret) return next();

  return res.status(401).json({ error: "Unauthorized: missing or invalid API secret" });
}

export default { requireSecret };
