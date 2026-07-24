/**
 * Resolve the public HLS master URL for a completed VOD encode job.
 * Uses the same CDN layout as insight-vod / vod-output-layout (not the S3 key prefix).
 */

import { resolveTenant } from "./auth.service.js";
import { resolveTenantS3 } from "./tenant-storage.service.js";
import { resolveTenantVideoProfiles } from "./video-profiles.service.js";
import { vodOutputUrls } from "./vod-output-layout.js";
import { resolveJobVodGuid } from "./vod-jobs.store.js";

/**
 * @param {import("./vod-jobs.store.js").VodJob} job
 * @returns {Promise<string | null>}
 */
export async function resolveJobMasterOutputUrl(job) {
  if (!job?.tenantId) return null;

  const spec = job.editorSpec && typeof job.editorSpec === "object" ? job.editorSpec : null;
  const fromSpec =
    spec && typeof spec.__masterUrl === "string" ? spec.__masterUrl.trim() : "";
  if (fromSpec && /^https?:\/\//i.test(fromSpec)) return fromSpec;

  const guid = resolveJobVodGuid(job);
  if (!guid) return null;

  try {
    const { accountId } = await resolveTenant(job.tenantId);
    const s3 = await resolveTenantS3({ accountId, tenantId: job.tenantId }).catch(() => null);
    if (!s3?.cdnBase) return null;
    let renditions = [];
    try {
      renditions = (await resolveTenantVideoProfiles({ accountId, tenantId: job.tenantId })) || [];
    } catch {
      /* optional */
    }
    const urls = vodOutputUrls({
      cdnBase: s3.cdnBase,
      tenantId: job.tenantId,
      guid,
      provider: s3.provider,
      bucket: s3.bucket,
      customerFolder: s3.customerFolder,
      renditions,
    });
    return urls.masterUrl || null;
  } catch {
    return null;
  }
}
