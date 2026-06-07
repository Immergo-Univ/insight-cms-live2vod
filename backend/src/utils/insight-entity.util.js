/**
 * Normalize Insight CMS / NestJS CRUD entity find responses.
 * With limit + page the API returns an object with data, count, total, page, pageCount.
 * Without pagination it may return a plain array or a single entity object.
 */
export function normalizeInsightEntityFindResults(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.data)) return payload.data;
    if (payload._id || payload.id) return [payload];
  }
  return [];
}

export function getInsightEntityFindMeta(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const page = Number(payload.page);
  const pageCount = Number(payload.pageCount);
  const total = Number(payload.total ?? payload.count);
  if (!Number.isFinite(page) || !Number.isFinite(pageCount)) return null;
  return {
    page,
    pageCount,
    total: Number.isFinite(total) ? total : undefined,
  };
}
