import { getSequelize } from "../db/sequelize.js";
import { isVodJobsPostgresEnabled } from "./vod-jobs-pg.repository.js";
import { getJob, mergeJobEditorSpec } from "./vod-jobs.store.js";
import { uploadVideoToYoutube } from "./tenant-syndication.service.js";
import { getActiveAccountsForPublish } from "./tenant-syndication-accounts.service.js";
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
 * @param {string} accountId
 * @param {Record<string, unknown>} uploadPatch
 */
function specWithYoutubeUploadPatch(spec, editorClipId, accountId, uploadPatch) {
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
  const yt = {
    ...(synd.youtube && typeof synd.youtube === "object" && !Array.isArray(synd.youtube) ? synd.youtube : {}),
  };
  const prevUploads =
    yt.uploads && typeof yt.uploads === "object" && !Array.isArray(yt.uploads) ? { ...yt.uploads } : {};
  const prevAccountUp =
    prevUploads[accountId] && typeof prevUploads[accountId] === "object" && !Array.isArray(prevUploads[accountId])
      ? prevUploads[accountId]
      : {};
  prevUploads[accountId] = { ...prevAccountUp, ...uploadPatch };
  yt.uploads = prevUploads;
  yt.upload = prevUploads[accountId];
  synd.youtube = yt;
  clip.syndication = synd;
  clips[idx] = clip;
  return { ...base, clips };
}

/**
 * After encoder marks job completed, upload to all connected YouTube accounts.
 *
 * @param {string} jobId
 */
export async function tryYoutubeSyndicationAfterJobCompleted(jobId) {
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
  if (tPlain.syndicationYoutubeEnabled !== true) return;

  const clip = pickClipFromSpec(spec, job.editorClipId || "");
  if (!clip) return;
  const synd = clip.syndication && typeof clip.syndication === "object" && !Array.isArray(clip.syndication) ? clip.syndication : {};
  const yt = synd.youtube && typeof synd.youtube === "object" && !Array.isArray(synd.youtube) ? synd.youtube : {};
  if (yt.enabled !== true) return;

  const accounts = await getActiveAccountsForPublish(job.tenantId, "youtube");
  if (!accounts.length) return;

  const videoUrl =
    typeof job.outputUrl === "string" && /^https?:\/\//i.test(job.outputUrl.trim())
      ? job.outputUrl.trim()
      : Array.isArray(job.outputUrls) && job.outputUrls.length > 0 && typeof job.outputUrls[0] === "string"
        ? String(job.outputUrls[0]).trim()
        : "";
  if (!videoUrl) {
    vodEncodeStdout(`youtube-syndication skip job=${jobId} reason=no_output_url`);
    return;
  }

  const meta = clip.metadata && typeof clip.metadata === "object" && !Array.isArray(clip.metadata) ? clip.metadata : {};
  const titleFromMeta = typeof meta.title === "string" ? meta.title.trim() : "";
  const descFromMeta = typeof meta.description === "string" ? meta.description.trim() : "";
  const tagsFromMeta = Array.isArray(meta.tags) ? meta.tags.map((x) => String(x)) : [];

  const opt = yt.options && typeof yt.options === "object" && !Array.isArray(yt.options) ? yt.options : {};
  const title = typeof opt.titleOverride === "string" && opt.titleOverride.trim() ? opt.titleOverride.trim() : titleFromMeta;
  const description =
    typeof opt.descriptionOverride === "string" && opt.descriptionOverride.trim()
      ? opt.descriptionOverride.trim()
      : descFromMeta;
  const tagsExtra = Array.isArray(opt.tagsExtra) ? opt.tagsExtra.map((x) => String(x)) : [];
  const tags = [...new Set([...tagsFromMeta, ...tagsExtra])].slice(0, 30);

  const uploadsMap =
    yt.uploads && typeof yt.uploads === "object" && !Array.isArray(yt.uploads) ? yt.uploads : {};

  for (const account of accounts) {
    const accountId = String(account.get("id"));
    const prevUp =
      uploadsMap[accountId] && typeof uploadsMap[accountId] === "object" && !Array.isArray(uploadsMap[accountId])
        ? uploadsMap[accountId]
        : yt.upload && typeof yt.upload === "object" && !Array.isArray(yt.upload) && accounts.length === 1
          ? yt.upload
          : {};
    if (prevUp.state === "published" || prevUp.state === "uploading") continue;

    const nowIso = new Date().toISOString();
    await mergeJobEditorSpec(jobId, (prev) =>
      specWithYoutubeUploadPatch(prev, job.editorClipId || "", accountId, {
        state: "uploading",
        message: "Uploading to YouTube…",
        updatedAt: nowIso,
      }),
    );

    try {
      const result = await uploadVideoToYoutube({
        tenantId: job.tenantId,
        accountId,
        videoUrl,
        snippet: {
          title: title || "Immergo clip",
          description: description || "",
          tags,
          categoryId: opt.categoryId != null ? String(opt.categoryId) : "22",
          defaultLanguage: opt.defaultLanguage ? String(opt.defaultLanguage) : undefined,
          defaultAudioLanguage: opt.defaultAudioLanguage ? String(opt.defaultAudioLanguage) : undefined,
        },
        status: {
          privacyStatus: opt.privacyStatus === "public" || opt.privacyStatus === "unlisted" ? opt.privacyStatus : "private",
          embeddable: opt.embeddable !== false,
          license: opt.license === "creativeCommon" ? "creativeCommon" : "youtube",
          publicStatsViewable: opt.publicStatsViewable !== false,
          selfDeclaredMadeForKids: Boolean(opt.selfDeclaredMadeForKids),
        },
        notifySubscribers: Boolean(opt.notifySubscribers),
      });

      await mergeJobEditorSpec(jobId, (prev) =>
        specWithYoutubeUploadPatch(prev, job.editorClipId || "", accountId, {
          state: "published",
          message: "Published on YouTube",
          videoId: result.videoId,
          watchUrl: result.url,
          updatedAt: new Date().toISOString(),
        }),
      );
      vodEncodeStdout(`youtube-syndication ok job=${jobId} account=${accountId} videoId=${result.videoId}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      vodEncodeStdout(`youtube-syndication failed job=${jobId} account=${accountId} err=${m.slice(0, 400)}`);
      await mergeJobEditorSpec(jobId, (prev) =>
        specWithYoutubeUploadPatch(prev, job.editorClipId || "", accountId, {
          state: "failed",
          message: "YouTube upload failed",
          error: m.slice(0, 2000),
          updatedAt: new Date().toISOString(),
        }),
      );
    }
  }
}
