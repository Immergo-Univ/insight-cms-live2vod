/**
 * Fetch with a hard timeout so hung CDNs/backends do not stall VOD jobs indefinitely.
 * Drops any caller `signal` to avoid mixing with the timeout controller.
 *
 * @param {string | URL} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 */
export async function fetchWithTimeout(url, init = {}, timeoutMs = 60000) {
  const { signal: _ignored, ...rest } = init;
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 60000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}
