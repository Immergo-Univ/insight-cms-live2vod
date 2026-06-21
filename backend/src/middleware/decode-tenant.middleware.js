import { decodeTenantId, getRequestTenantId } from "../utils/tenant-cipher.js";

/**
 * Normalizes the tenant id to plaintext at the edge, so every downstream
 * handler works with the real tenant regardless of whether the CMS embedded
 * this app with the tenant encrypted (CryptoJS AES) or in plaintext.
 *
 * Express 5 exposes req.query as read-only; mutating req.query.tenantId is
 * ignored. We decode headers/body in place and attach req.decodedTenantId for
 * handlers that call getRequestTenantId().
 *
 * Path params (`:tenantId`) are handled separately via `decodeTenantParam`.
 */
export function decodeTenantMiddleware(req, _res, next) {
  try {
    const headerTenant = req.headers["x-tenant-id"];
    if (headerTenant != null) {
      req.headers["x-tenant-id"] = decodeTenantId(headerTenant);
    }
    if (req.body && typeof req.body === "object" && req.body.tenantId != null) {
      req.body.tenantId = decodeTenantId(req.body.tenantId);
    }
    const decoded = getRequestTenantId(req);
    if (decoded) req.decodedTenantId = decoded;
  } catch {
    // never block the request on decode issues
  }
  next();
}

/**
 * Express `router.param("tenantId", ...)` handler that decodes a `:tenantId`
 * path segment in place.
 */
export function decodeTenantParam(req, _res, next, value) {
  try {
    req.params.tenantId = decodeTenantId(value);
  } catch {
    // keep original value on failure
  }
  next();
}
