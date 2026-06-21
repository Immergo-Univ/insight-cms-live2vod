import { decodeTenantId } from "../utils/tenant-cipher.js";

/**
 * Normalizes the tenant id to plaintext at the edge, so every downstream
 * handler works with the real tenant regardless of whether the CMS embedded
 * this app with the tenant encrypted (CryptoJS AES) or in plaintext.
 *
 * Covers `?tenantId=`, the `x-tenant-id` header and `body.tenantId`.
 * Path params (`:tenantId`) are handled separately via `decodeTenantParam`.
 */
export function decodeTenantMiddleware(req, _res, next) {
  try {
    if (req.query && req.query.tenantId != null) {
      req.query.tenantId = decodeTenantId(req.query.tenantId);
    }
    const headerTenant = req.headers["x-tenant-id"];
    if (headerTenant != null) {
      req.headers["x-tenant-id"] = decodeTenantId(headerTenant);
    }
    if (req.body && typeof req.body === "object" && req.body.tenantId != null) {
      req.body.tenantId = decodeTenantId(req.body.tenantId);
    }
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
