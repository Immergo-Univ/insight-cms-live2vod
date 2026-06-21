import CryptoJS from "crypto-js";

/**
 * Shared key used by insight-api/BI to encrypt the tenant id
 * (`CryptoJS.AES.encrypt(tenant, "secretKey")`). This matches the existing
 * BI/analytics scheme so the CMS can embed this app with the tenant passed
 * encrypted in the URL. It is obfuscation, not real secrecy — but the key now
 * lives only on the server, never in the frontend bundle.
 */
const TENANT_CIPHER_KEY = process.env.TENANT_CIPHER_KEY || "secretKey";

/** CryptoJS AES (OpenSSL) ciphertext is base64 of "Salted__..." → starts with this. */
const OPENSSL_B64_PREFIX = "U2FsdGVkX1";

/**
 * Decode a tenant id. Transparently supports both:
 *  - encrypted values (CryptoJS AES, as produced by insight-api `getClient`)
 *  - plaintext values (e.g. `channel14`) for local/dev use and OAuth redirects.
 * @param {unknown} raw
 * @returns {string}
 */
export function decodeTenantId(raw) {
  const value = (raw == null ? "" : String(raw)).trim();
  if (!value) return "";

  if (value.startsWith(OPENSSL_B64_PREFIX)) {
    try {
      const decrypted = CryptoJS.AES.decrypt(value, TENANT_CIPHER_KEY).toString(
        CryptoJS.enc.Utf8,
      );
      if (decrypted) return decrypted.trim();
    } catch {
      // fall through and return the raw value
    }
  }

  return value;
}

/**
 * Read tenant id from an Express request (query, x-tenant-id header, or body).
 * Always decodes CryptoJS AES ciphertext. Express 5 makes req.query read-only, so
 * callers must not rely on mutating req.query.tenantId in middleware.
 * @param {import("express").Request} req
 * @returns {string}
 */
export function getRequestTenantId(req) {
  const raw =
    req.query?.tenantId ??
    req.headers?.["x-tenant-id"] ??
    (req.body && typeof req.body === "object" ? req.body.tenantId : undefined);
  return decodeTenantId(raw);
}
