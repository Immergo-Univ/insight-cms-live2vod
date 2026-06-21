/**
 * Dispatches VOD encode jobs to encoder-lite and forwards cancel requests.
 */

import { randomUUID } from "crypto";
import { createJob, updateJob } from "./vod-jobs.store.js";
import { config } from "../config.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";
import { resolveTenant } from "./auth.service.js";
import { resolveTenantS3 } from "./tenant-storage.service.js";

/**
 * Resolve the tenant's S3 destination from insight-api (best-effort).
 * Returns undefined on any failure so dispatch can fall back to the encoder's config.
 * @param {string} tenantId
 * @param {string} jobId
 */
async function resolveS3ForTenant(tenantId, jobId) {
  try {
    const { accountId } = await resolveTenant(tenantId);
    const s3 = await resolveTenantS3({ accountId, tenantId });
    if (s3) return s3;
    vodEncodeStdout(
      `tenant ${tenantId} has no resolvable S3 storage; encoder will use its fallback (job=${jobId})`,
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    vodEncodeStdout(`failed to resolve tenant S3 job=${jobId} tenant=${tenantId} err=${m}`);
  }
  return undefined;
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
      const s3 = await resolveS3ForTenant(tenantId, jobId);
      const res = await fetch(`${serviceUrl}/encoder/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          jobId,
          tenantId,
          spec,
          ...(editorClipId ? { editorClipId } : {}),
          ...(s3 ? { s3 } : {}),
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
