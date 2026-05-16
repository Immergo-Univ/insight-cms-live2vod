import { getSequelize } from "../db/sequelize.js";
import { isVodJobsPostgresEnabled } from "./vod-jobs-pg.repository.js";
import { getJob, mergeJobEditorSpec } from "./vod-jobs.store.js";
import { uploadVideoToInstagram } from "./tenant-syndication.service.js";
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
function specWithInstagramSyndicationUploadPatch(spec, editorClipId, uploadPatch) {
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
  const ig = {
    ...(synd.instagram && typeof synd.instagram === "object" && !Array.isArray(synd.instagram) ? synd.instagram : {}),
  };
  const prevUp = ig.upload && typeof ig.upload === "object" && !Array.isArray(ig.upload) ? ig.upload : {};
  ig.upload = { ...prevUp, ...uploadPatch };
  synd.instagram = ig;
  clip.syndication = synd;
  clips[idx] = clip;
  return { ...base, clips };
}

/**
 * After encoder marks job completed, optionally publish to Instagram (Postgres jobs with editorSpec only).
 *
 * @param {string} jobId
 */
export async function tryInstagramSyndicationAfterJobCompleted(jobId) {
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
  if (tPlain.syndicationInstagramEnabled !== true) return;
  if (!tPlain.instagramBusinessAccountId || !tPlain.instagramPageAccessToken) return;

  const clip = pickClipFromSpec(spec, job.editorClipId || "");
  if (!clip) return;
  const synd = clip.syndication && typeof clip.syndication === "object" && !Array.isArray(clip.syndication) ? clip.syndication : {};
  const ig = synd.instagram && typeof synd.instagram === "object" && !Array.isArray(synd.instagram) ? synd.instagram : {};
  if (ig.enabled !== true) return;

  const up = ig.upload && typeof ig.upload === "object" && !Array.isArray(ig.upload) ? ig.upload : {};
  if (up.state === "published" || up.state === "uploading") return;

  const videoUrl =
    typeof job.outputUrl === "string" && /^https?:\/\//i.test(job.outputUrl.trim())
      ? job.outputUrl.trim()
      : Array.isArray(job.outputUrls) && job.outputUrls.length > 0 && typeof job.outputUrls[0] === "string"
        ? String(job.outputUrls[0]).trim()
        : "";
  if (!videoUrl) {
    vodEncodeStdout(`instagram-syndication skip job=${jobId} reason=no_output_url`);
    return;
  }

  const meta = clip.metadata && typeof clip.metadata === "object" && !Array.isArray(clip.metadata) ? clip.metadata : {};
  const titleFromMeta = typeof meta.title === "string" ? meta.title.trim() : "";
  const descFromMeta = typeof meta.description === "string" ? meta.description.trim() : "";

  const opt = ig.options && typeof ig.options === "object" && !Array.isArray(ig.options) ? ig.options : {};
  const captionOverride = typeof opt.captionOverride === "string" ? opt.captionOverride.trim() : "";
  const mediaTypeRaw = typeof opt.mediaType === "string" ? opt.mediaType.trim().toLowerCase() : "reels";
  const mediaType = mediaTypeRaw === "feed" ? "feed" : "reels";

  const captionParts = [];
  if (captionOverride) captionParts.push(captionOverride);
  else {
    if (titleFromMeta) captionParts.push(titleFromMeta);
    if (descFromMeta) captionParts.push(descFromMeta);
  }
  const caption = captionParts.join("\n\n").trim() || " ";

  const nowIso = new Date().toISOString();
  await mergeJobEditorSpec(jobId, (prev) =>
    specWithInstagramSyndicationUploadPatch(prev, job.editorClipId || "", {
      state: "uploading",
      message: mediaType === "feed" ? "Uploading to Instagram feed…" : "Uploading to Instagram Reels…",
      updatedAt: nowIso,
    }),
  );

  try {
    const result = await uploadVideoToInstagram({
      tenantId: job.tenantId,
      videoUrl,
      caption,
      mediaType,
    });

    await mergeJobEditorSpec(jobId, (prev) =>
      specWithInstagramSyndicationUploadPatch(prev, job.editorClipId || "", {
        state: "published",
        message: mediaType === "feed" ? "Published on Instagram feed" : "Published on Instagram Reels",
        mediaId: result.mediaId,
        permalinkUrl: result.permalinkUrl,
        updatedAt: new Date().toISOString(),
      }),
    );
    vodEncodeStdout(`instagram-syndication ok job=${jobId} mediaId=${result.mediaId}`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    vodEncodeStdout(`instagram-syndication failed job=${jobId} err=${m.slice(0, 400)}`);
    await mergeJobEditorSpec(jobId, (prev) =>
      specWithInstagramSyndicationUploadPatch(prev, job.editorClipId || "", {
        state: "failed",
        message: "Instagram upload failed",
        error: m.slice(0, 2000),
        updatedAt: new Date().toISOString(),
      }),
    );
  }
}
