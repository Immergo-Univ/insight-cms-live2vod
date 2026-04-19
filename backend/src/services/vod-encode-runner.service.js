/**
 * Dispatches VOD encode jobs to encoder-lite and forwards cancel requests.
 */

import { randomUUID } from "crypto";
import { createJob, updateJob } from "./vod-jobs.store.js";
import { config } from "../config.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";

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
export function startBackgroundVodJob(opts) {
  const jobId = randomUUID();
  const { tenantId, spec, clipUrlPreview, editorClipId } = opts;

  createJob({
    id: jobId,
    tenantId,
    status: "queued",
    progress: 0,
    phase: "queued",
    message: "Queued",
    clipUrl: clipUrlPreview || spec.clipUrl,
    ...(editorClipId ? { editorClipId } : {}),
  });

  const subs = anySubtitlesEnabled(spec);
  vodEncodeStdout(
    `queued job=${jobId} tenant=${tenantId} subtitles=${subs ? "yes" : "no"}${editorClipId ? ` editorClipId=${editorClipId}` : ""}`,
  );

  const { serviceUrl, secret } = config.encoder;
  if (!serviceUrl || !secret) {
    updateJob(jobId, {
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
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        const msg = `Encoder rejected job (${res.status}): ${t.slice(0, 400)}`;
        console.error(`[vod] dispatch job=${jobId}`, msg);
        updateJob(jobId, {
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
      updateJob(jobId, {
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
