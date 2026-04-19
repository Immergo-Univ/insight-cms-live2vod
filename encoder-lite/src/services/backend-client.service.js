import { config } from "../config.js";

/**
 * @param {string} jobId
 * @param {Record<string, unknown>} patch
 */
export async function patchBackendJob(jobId, patch) {
  const base = config.backendBaseUrl;
  if (!base) throw new Error("BACKEND_BASE_URL is not set");
  const url = `${base}/api/encoder/jobs/${encodeURIComponent(jobId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.secret}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Backend job patch failed ${res.status}: ${t.slice(0, 400)}`);
  }
}
