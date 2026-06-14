import { getSequelize } from "../db/sequelize.js";
import { isVodJobsPostgresEnabled } from "./vod-jobs-pg.repository.js";
import { getJob, mergeJobEditorSpec } from "./vod-jobs.store.js";
import { uploadVideoToTwitter } from "./tenant-syndication.service.js";
import { getActiveAccountsForPublish } from "./tenant-syndication-accounts.service.js";
import { vodEncodeStdout } from "../utils/vod-encode-log.js";

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

function specWithTwitterUploadPatch(spec, editorClipId, accountId, uploadPatch) {
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
  const tw = {
    ...(synd.twitter && typeof synd.twitter === "object" && !Array.isArray(synd.twitter) ? synd.twitter : {}),
  };
  const prevUploads =
    tw.uploads && typeof tw.uploads === "object" && !Array.isArray(tw.uploads) ? { ...tw.uploads } : {};
  const prevAccountUp =
    prevUploads[accountId] && typeof prevUploads[accountId] === "object" && !Array.isArray(prevUploads[accountId])
      ? prevUploads[accountId]
      : {};
  prevUploads[accountId] = { ...prevAccountUp, ...uploadPatch };
  tw.uploads = prevUploads;
  tw.upload = prevUploads[accountId];
  synd.twitter = tw;
  clip.syndication = synd;
  clips[idx] = clip;
  return { ...base, clips };
}

export async function tryTwitterSyndicationAfterJobCompleted(jobId) {
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
  if (tenantRow.get({ plain: true }).syndicationTwitterEnabled !== true) return;

  const clip = pickClipFromSpec(spec, job.editorClipId || "");
  if (!clip) return;
  const synd = clip.syndication && typeof clip.syndication === "object" && !Array.isArray(clip.syndication) ? clip.syndication : {};
  const tw = synd.twitter && typeof synd.twitter === "object" && !Array.isArray(synd.twitter) ? synd.twitter : {};
  if (tw.enabled !== true) return;

  const accounts = await getActiveAccountsForPublish(job.tenantId, "twitter");
  if (!accounts.length) return;

  const videoUrl =
    typeof job.outputUrl === "string" && /^https?:\/\//i.test(job.outputUrl.trim())
      ? job.outputUrl.trim()
      : Array.isArray(job.outputUrls) && job.outputUrls.length > 0 && typeof job.outputUrls[0] === "string"
        ? String(job.outputUrls[0]).trim()
        : "";
  if (!videoUrl) {
    vodEncodeStdout(`twitter-syndication skip job=${jobId} reason=no_output_url`);
    return;
  }

  const meta = clip.metadata && typeof clip.metadata === "object" && !Array.isArray(clip.metadata) ? clip.metadata : {};
  const titleFromMeta = typeof meta.title === "string" ? meta.title.trim() : "";
  const opt = tw.options && typeof tw.options === "object" && !Array.isArray(tw.options) ? tw.options : {};
  const textOverride = typeof opt.textOverride === "string" ? opt.textOverride.trim() : "";
  const tweetText = textOverride || titleFromMeta || " ";
  const uploadsMap =
    tw.uploads && typeof tw.uploads === "object" && !Array.isArray(tw.uploads) ? tw.uploads : {};

  for (const account of accounts) {
    const accountId = String(account.get("id"));
    const prevUp =
      uploadsMap[accountId] && typeof uploadsMap[accountId] === "object" && !Array.isArray(uploadsMap[accountId])
        ? uploadsMap[accountId]
        : tw.upload && typeof tw.upload === "object" && !Array.isArray(tw.upload) && accounts.length === 1
          ? tw.upload
          : {};
    if (prevUp.state === "published" || prevUp.state === "uploading") continue;

    await mergeJobEditorSpec(jobId, (prev) =>
      specWithTwitterUploadPatch(prev, job.editorClipId || "", accountId, {
        state: "uploading",
        message: "Uploading to X…",
        updatedAt: new Date().toISOString(),
      }),
    );

    try {
      const result = await uploadVideoToTwitter({
        tenantId: job.tenantId,
        accountId,
        videoUrl,
        text: tweetText,
      });
      await mergeJobEditorSpec(jobId, (prev) =>
        specWithTwitterUploadPatch(prev, job.editorClipId || "", accountId, {
          state: "published",
          message: "Published on X",
          tweetId: result.tweetId,
          tweetUrl: result.url,
          updatedAt: new Date().toISOString(),
        }),
      );
      vodEncodeStdout(`twitter-syndication ok job=${jobId} account=${accountId} tweetId=${result.tweetId}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      vodEncodeStdout(`twitter-syndication failed job=${jobId} account=${accountId} err=${m.slice(0, 400)}`);
      await mergeJobEditorSpec(jobId, (prev) =>
        specWithTwitterUploadPatch(prev, job.editorClipId || "", accountId, {
          state: "failed",
          message: "X upload failed",
          error: m.slice(0, 2000),
          updatedAt: new Date().toISOString(),
        }),
      );
    }
  }
}
