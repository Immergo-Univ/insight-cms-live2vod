import { getSequelize } from "../db/sequelize.js";
import { isVodJobsPostgresEnabled } from "./vod-jobs-pg.repository.js";
import { getJob, mergeJobEditorSpec } from "./vod-jobs.store.js";
import { uploadVideoToFacebook } from "./tenant-syndication.service.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";

/**
 * @param {Record<string, unknown>} spec
 * @param {string} editorClipId
 */
function pickClipFromSpec(spec, editorClipId) {
  const clips = Array.isArray(spec?.clips) ? spec.clips : [];
  if (!clips.length) return null;
  const sid = String(editorClipId || "").trim();
  if (sid) {
    const found = clips.find(
      (c) => c && typeof c === "object" && String(/** @type {{ editorClientClipId?: string }} */ (c).editorClientClipId || "") === sid,
    );
    if (found) return /** @type {Record<string, unknown>} */ (found);
  }
  if (clips.length === 1 && clips[0] && typeof clips[0] === "object") return /** @type {Record<string, unknown>} */ (clips[0]);
  return null;
}

/**
 * @param {Record<string, unknown>} spec
 * @param {string} editorClipId
 * @param {Record<string, unknown>} uploadPatch
 */
function specWithFacebookSyndicationUploadPatch(spec, editorClipId, uploadPatch) {
  const base = spec && typeof spec === "object" && !Array.isArray(spec) ? { ...spec } : {};
  const clips = Array.isArray(base.clips) ? base.clips.map((c) => (c && typeof c === "object" ? { ...c } : c)) : [];
  const sid = String(editorClipId || "").trim();
  let idx = clips.findIndex(
    (c) => c && typeof c === "object" && String(/** @type {{ editorClientClipId?: string }} */ (c).editorClientClipId || "") === sid,
  );
  if (idx < 0 && clips.length === 1) idx = 0;
  if (idx < 0 || !clips[idx] || typeof clips[idx] !== "object") return base;
  const clip = { .../** @type {Record<string, unknown>} */ (clips[idx]) };
  const synd = {
    ...(clip.syndication && typeof clip.syndication === "object" && !Array.isArray(clip.syndication) ? clip.syndication : {}),
  };
  const fb = {
    ...(synd.facebook && typeof synd.facebook === "object" && !Array.isArray(synd.facebook) ? synd.facebook : {}),
  };
  const prevUp = fb.upload && typeof fb.upload === "object" && !Array.isArray(fb.upload) ? fb.upload : {};
  fb.upload = { ...prevUp, ...uploadPatch };
  synd.facebook = fb;
  clip.syndication = synd;
  clips[idx] = clip;
  return { ...base, clips };
}

/**
 * After encoder marks job completed, optionally upload to Facebook Page (Postgres jobs with editorSpec only).
 *
 * @param {string} jobId
 */
export async function tryFacebookSyndicationAfterJobCompleted(jobId) {
  if (!isVodJobsPostgresEnabled()) return;
  const job = await getJob(jobId);
  if (!job || job.status !== "completed") return;
  const spec = job.editorSpec && typeof job.editorSpec === "object" && !Array.isArray(job.editorSpec) ? job.editorSpec : null;
  if (!spec) return;

  const sequelize = getSequelize();
  if (!sequelize) return;
  const { Tenant } = sequelize.models;
  const tenantRow = await Tenant.findByPk(job.tenantId);
  if (!tenantRow) return;
  const tPlain = tenantRow.get({ plain: true });
  if (tPlain.syndicationFacebookEnabled !== true) return;
  if (!tPlain.facebookPageId || !tPlain.facebookPageAccessToken) return;

  const clip = pickClipFromSpec(spec, job.editorClipId || "");
  if (!clip) return;
  const synd = clip.syndication && typeof clip.syndication === "object" && !Array.isArray(clip.syndication) ? clip.syndication : {};
  const fb = synd.facebook && typeof synd.facebook === "object" && !Array.isArray(synd.facebook) ? synd.facebook : {};
  if (fb.enabled !== true) return;

  const up = fb.upload && typeof fb.upload === "object" && !Array.isArray(fb.upload) ? fb.upload : {};
  if (up.state === "published" || up.state === "uploading") return;

  const videoUrl =
    typeof job.outputUrl === "string" && /^https?:\/\//i.test(job.outputUrl.trim())
      ? job.outputUrl.trim()
      : Array.isArray(job.outputUrls) && job.outputUrls.length > 0 && typeof job.outputUrls[0] === "string"
        ? String(job.outputUrls[0]).trim()
        : "";
  if (!videoUrl) {
    vodEncodeStdout(`facebook-syndication skip job=${jobId} reason=no_output_url`);
    return;
  }

  const meta = clip.metadata && typeof clip.metadata === "object" && !Array.isArray(clip.metadata) ? clip.metadata : {};
  const titleFromMeta = typeof meta.title === "string" ? meta.title.trim() : "";
  const descFromMeta = typeof meta.description === "string" ? meta.description.trim() : "";

  const opt = fb.options && typeof fb.options === "object" && !Array.isArray(fb.options) ? fb.options : {};
  const titleOverride = typeof opt.titleOverride === "string" ? opt.titleOverride.trim() : "";
  const descriptionOverride = typeof opt.descriptionOverride === "string" ? opt.descriptionOverride.trim() : "";
  const videoTitle = titleOverride || titleFromMeta || "Untitled";
  const videoDescription = descriptionOverride || descFromMeta || "";

  const nowIso = new Date().toISOString();
  await mergeJobEditorSpec(jobId, (prev) =>
    specWithFacebookSyndicationUploadPatch(prev, job.editorClipId || "", {
      state: "uploading",
      message: "Uploading to Facebook…",
      updatedAt: nowIso,
    }),
  );

  try {
    const result = await uploadVideoToFacebook({
      tenantId: job.tenantId,
      videoUrl,
      title: videoTitle,
      description: videoDescription,
    });

    await mergeJobEditorSpec(jobId, (prev) =>
      specWithFacebookSyndicationUploadPatch(prev, job.editorClipId || "", {
        state: "published",
        message: "Published on Facebook",
        postId: result.postId,
        permalinkUrl: result.url,
        updatedAt: new Date().toISOString(),
      }),
    );
    vodEncodeStdout(`facebook-syndication ok job=${jobId} postId=${result.postId}`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    vodEncodeStdout(`facebook-syndication failed job=${jobId} err=${m.slice(0, 400)}`);
    await mergeJobEditorSpec(jobId, (prev) =>
      specWithFacebookSyndicationUploadPatch(prev, job.editorClipId || "", {
        state: "failed",
        message: "Facebook upload failed",
        error: m.slice(0, 2000),
        updatedAt: new Date().toISOString(),
      }),
    );
  }
}
