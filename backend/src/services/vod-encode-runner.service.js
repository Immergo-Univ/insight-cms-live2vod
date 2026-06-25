/**
 * Dispatches VOD encode jobs to encoder-lite and forwards cancel requests.
 */

import { randomUUID } from "crypto";
import { createJob, updateJob, mergeJobEditorSpec } from "./vod-jobs.store.js";
import { config } from "../config.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";
import { resolveTenant } from "./auth.service.js";
import { resolveTenantS3 } from "./tenant-storage.service.js";
import { resolveTenantVideoProfiles } from "./video-profiles.service.js";
import { legacyOutputPrefix } from "./vod-output-layout.js";
import { createInsightVod } from "./insight-vod.service.js";

/**
 * Resolve the tenant's insight-api account id, S3 destination and video profiles.
 * Returns undefined fields on failure so dispatch can fall back to the encoder's config.
 * @param {string} tenantId
 * @param {string} jobId
 * @returns {Promise<{ accountId?: string, s3?: object, renditions?: object[] }>}
 */
async function resolveTenantContext(tenantId, jobId) {
  try {
    const { accountId } = await resolveTenant(tenantId);
    let s3;
    let renditions;
    try {
      s3 = await resolveTenantS3({ accountId, tenantId });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      vodEncodeStdout(`failed to resolve tenant S3 job=${jobId} tenant=${tenantId} err=${m}`);
    }
    try {
      renditions = await resolveTenantVideoProfiles({ accountId, tenantId });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      vodEncodeStdout(
        `failed to resolve video profiles job=${jobId} tenant=${tenantId} err=${m}`,
      );
    }
    if (!s3) {
      vodEncodeStdout(
        `tenant ${tenantId} has no resolvable S3 storage; encoder will use its fallback (job=${jobId})`,
      );
    }
    return { accountId, s3: s3 || undefined, renditions: renditions || undefined };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    vodEncodeStdout(`failed to resolve tenant context job=${jobId} tenant=${tenantId} err=${m}`);
    return {};
  }
}

/**
 * Build the S3 payload forwarded to the encoder, including legacy output path.
 * @param {object} s3 resolved tenant S3
 * @param {string} tenantId
 */
function buildEncoderS3Payload(s3, tenantId) {
  if (!s3) return undefined;
  const customerFolder = s3.customerFolder || tenantId;
  return {
    bucket: s3.bucket,
    key: s3.key,
    secret: s3.secret,
    hostname: s3.hostname,
    cdnBase: s3.cdnBase,
    customerFolder,
    output: legacyOutputPrefix(tenantId, customerFolder),
  };
}

/**
 * Create the VOD document in insight-api (Mongo) like the legacy flow, and build
 * the legacy webhook descriptor the encoder will call. Best-effort: on failure the
 * encode still runs (the editor flow keeps working) but insight-cms won't track it.
 * Skipped for transcript-only jobs (no video output).
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} opts.spec
 * @param {string} [opts.accountId]
 * @param {object} [opts.s3]
 * @param {Array<object>} [opts.renditions]
 * @param {string} opts.jobId
 * @returns {Promise<{ vodGuid?: string, insightWebhook?: object }>}
 */
async function createInsightVodForJob({ tenantId, spec, accountId, s3, renditions, jobId }) {
  if (spec?.realtimeTranscribeOnly === true || !accountId) return {};
  try {
    const { guid } = await createInsightVod({
      accountId,
      tenantId,
      spec,
      s3,
      customerFolder: s3?.customerFolder,
      renditions,
    });
    const insightWebhook = {
      url: `${config.insightApiBase}/cms/pentity/${encodeURIComponent(tenantId)}/vods/webhook`,
      mediaId: guid,
      headers: { "x-tenant-id": tenantId },
    };
    // Persist the guid for traceability (in-memory field + editorSpec for Postgres).
    await updateJob(jobId, { vodGuid: guid });
    await mergeJobEditorSpec(jobId, (prev) => ({ ...(prev || {}), __vodGuid: guid })).catch(
      () => {},
    );
    vodEncodeStdout(`insight VOD created job=${jobId} guid=${guid}`);
    return { vodGuid: guid, insightWebhook };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    vodEncodeStdout(`insight VOD create failed job=${jobId} tenant=${tenantId} err=${m}`);
    return {};
  }
}

function anySubtitlesEnabled(spec) {
  const s = spec?.subtitles;
  if (s && typeof s === "object" && s.enabled === true) return true;
  return Array.isArray(spec?.clips) && spec.clips.some((c) => c?.subtitles?.enabled === true);
}

/**
 * Ask remote encoder to stop (best-effort).
 * @param {string} jobId
 */
export function requestCancelJob(jobId) {
  const base = config.encoder.serviceUrl;
  const secret = config.encoder.secret;
  if (!base || !secret) return;
  const url = `${base}/encoder/jobs/${encodeURIComponent(jobId)}/cancel`;
  void fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  }).catch((e) => {
    const m = e instanceof Error ? e.message : String(e);
    vodEncodeStdout(`cancel forward failed job=${jobId} err=${m}`);
  });
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} opts.spec
 * @param {string} [opts.clipUrlPreview]
 * @param {string} [opts.editorClipId]
 * @returns {string} jobId
 */
export async function startBackgroundVodJob(opts) {
  const jobId = randomUUID();
  const { tenantId, spec, clipUrlPreview, editorClipId } = opts;

  await createJob({
    id: jobId,
    tenantId,
    status: "queued",
    progress: 0,
    phase: "queued",
    message: "Queued",
    clipUrl: clipUrlPreview || spec.clipUrl,
    jobKind: spec?.realtimeTranscribeOnly === true ? "realtime_transcribe" : "vod_encode",
    ...(editorClipId ? { editorClipId } : {}),
    editorSpec: spec && typeof spec === "object" ? JSON.parse(JSON.stringify(spec)) : null,
  });

  const subs = anySubtitlesEnabled(spec);
  vodEncodeStdout(
    `queued job=${jobId} tenant=${tenantId} subtitles=${subs ? "yes" : "no"}${editorClipId ? ` editorClipId=${editorClipId}` : ""}`,
  );

  const { serviceUrl, secret } = config.encoder;
  if (!serviceUrl || !secret) {
    await updateJob(jobId, {
      status: "failed",
      progress: 0,
      phase: "failed",
      error: "Encoder not configured",
      message: "Set ENCODER_SERVICE_URL and SECRET on the backend",
    });
    return jobId;
  }

  void (async () => {
    try {
      const { accountId, s3, renditions } = await resolveTenantContext(tenantId, jobId);
      const encoderS3 = buildEncoderS3Payload(s3, tenantId);
      const { vodGuid, insightWebhook } = await createInsightVodForJob({
        tenantId,
        spec,
        accountId,
        s3,
        renditions,
        jobId,
      });
      const res = await fetch(`${serviceUrl}/encoder/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          // Discriminator read by immergo-vod-encoder-api to route this message
          // through the NEW per-rendition Live2VOD path (vs the legacy /episodes flow).
          encoderType: "new",
          jobId,
          tenantId,
          spec,
          ...(editorClipId ? { editorClipId } : {}),
          ...(encoderS3 ? { s3: encoderS3 } : {}),
          ...(renditions ? { renditions } : {}),
          ...(vodGuid ? { vodGuid } : {}),
          ...(insightWebhook ? { insightWebhook } : {}),
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        const msg = `Encoder rejected job (${res.status}): ${t.slice(0, 400)}`;
        console.error(`[vod] dispatch job=${jobId}`, msg);
        await updateJob(jobId, {
          status: "failed",
          progress: 0,
          phase: "failed",
          error: msg,
          message: msg.slice(0, 200),
        });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[vod] dispatch job=${jobId} network error`, m);
      await updateJob(jobId, {
        status: "failed",
        progress: 0,
        phase: "failed",
        error: m,
        message: `Encoder unreachable: ${m.slice(0, 200)}`,
      });
    }
  })();

  return jobId;
}
