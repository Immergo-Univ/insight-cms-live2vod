/**
 * YouTube publish defaults stored on a syndication account and applied by the upload runner.
 * Values match YouTube Data API videos.insert (snippet + status) and the notifySubscribers flag.
 */

import { applyTextTemplate, asTrimmedString } from "./syndication-text-template.service.js";

const CATEGORY_BY_LABEL = {
  "News & Politics": "25",
  Entertainment: "24",
  Education: "27",
  Sports: "17",
  "People & Blogs": "22",
};

const LANGUAGE_BY_LABEL = {
  Arabic: "ar",
  English: "en",
  Hebrew: "he",
  French: "fr",
  Spanish: "es",
};

const LICENSE_BY_LABEL = {
  "Standard YouTube License": "youtube",
  "Creative Commons – Attribution": "creativeCommon",
  "Creative Commons - Attribution": "creativeCommon",
};

const PRIVACY_BY_LABEL = {
  Public: "public",
  Unlisted: "unlisted",
  Private: "private",
};

export function defaultYoutubeAccountSettings() {
  return {
    privacyStatus: "private",
    categoryId: "25",
    selfDeclaredMadeForKids: false,
    defaultLanguage: "en",
    license: "youtube",
    embeddable: true,
    notifySubscribers: true,
    publicStatsViewable: true,
    titleTemplate: "{title}",
    descriptionTemplate: "{short_description}",
    tags: ["News"],
  };
}

/**
 * @param {unknown} raw
 */
export function normalizeYoutubeAccountSettings(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
  const defaults = defaultYoutubeAccountSettings();

  const privacyRaw = asTrimmedString(src.privacyStatus) || asTrimmedString(src.privacy);
  const privacyStatus =
    PRIVACY_BY_LABEL[privacyRaw] ||
    (privacyRaw === "public" || privacyRaw === "unlisted" || privacyRaw === "private" ? privacyRaw : defaults.privacyStatus);

  const categoryRaw = asTrimmedString(src.categoryId) || asTrimmedString(src.category);
  const categoryId = CATEGORY_BY_LABEL[categoryRaw] || (/^\d+$/.test(categoryRaw) ? categoryRaw : defaults.categoryId);

  const languageRaw = asTrimmedString(src.defaultLanguage) || asTrimmedString(src.vlang);
  const defaultLanguage =
    LANGUAGE_BY_LABEL[languageRaw] || (/^[a-z]{2}(-[A-Za-z0-9]+)?$/.test(languageRaw) ? languageRaw : defaults.defaultLanguage);

  const licenseRaw = asTrimmedString(src.license);
  const license =
    LICENSE_BY_LABEL[licenseRaw] || (licenseRaw === "youtube" || licenseRaw === "creativeCommon" ? licenseRaw : defaults.license);

  const kidsRaw = src.selfDeclaredMadeForKids ?? src.kids;
  const selfDeclaredMadeForKids =
    typeof kidsRaw === "boolean"
      ? kidsRaw
      : kidsRaw === "Made for kids"
        ? true
        : kidsRaw === "Not made for kids"
          ? false
          : defaults.selfDeclaredMadeForKids;

  const tagsRaw = Array.isArray(src.tags) ? src.tags : defaults.tags;
  const tags = [...new Set(tagsRaw.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 30);

  return {
    privacyStatus,
    categoryId,
    selfDeclaredMadeForKids,
    defaultLanguage,
    license,
    embeddable: typeof src.embeddable === "boolean" ? src.embeddable : defaults.embeddable,
    notifySubscribers: typeof src.notifySubscribers === "boolean" ? src.notifySubscribers : defaults.notifySubscribers,
    publicStatsViewable: typeof src.publicStatsViewable === "boolean" ? src.publicStatsViewable : defaults.publicStatsViewable,
    titleTemplate: asTrimmedString(src.titleTemplate) || defaults.titleTemplate,
    descriptionTemplate: asTrimmedString(src.descriptionTemplate) || defaults.descriptionTemplate,
    tags,
  };
}

/**
 * Merge account defaults with per-clip overrides. A clip field wins only when it was stored.
 *
 * @param {unknown} settings
 * @param {Record<string, unknown>} opt
 * @param {{ title?: string, description?: string, tags?: string[] }} meta
 */
export function resolveYoutubePublishOptions(settings, opt, meta) {
  const account = normalizeYoutubeAccountSettings(settings);
  const clip = opt && typeof opt === "object" ? opt : {};

  const titleOverride = asTrimmedString(clip.titleOverride);
  const descriptionOverride = asTrimmedString(clip.descriptionOverride);
  const title = titleOverride || applyTextTemplate(account.titleTemplate, meta) || asTrimmedString(meta?.title) || "Immergo clip";
  const description = descriptionOverride || applyTextTemplate(account.descriptionTemplate, meta) || asTrimmedString(meta?.description);

  const clipTags = Array.isArray(meta?.tags) ? meta.tags.map((tag) => String(tag)) : [];
  const extraTags = Array.isArray(clip.tagsExtra) ? clip.tagsExtra.map((tag) => String(tag)) : [];
  const tags = [...new Set([...account.tags, ...clipTags, ...extraTags].map((tag) => tag.trim()).filter(Boolean))].slice(0, 30);

  const clipPrivacy = asTrimmedString(clip.privacyStatus);
  const privacyStatus =
    clipPrivacy === "public" || clipPrivacy === "unlisted" || clipPrivacy === "private" ? clipPrivacy : account.privacyStatus;

  const clipCategory = asTrimmedString(clip.categoryId);
  const categoryId = /^\d+$/.test(clipCategory) ? clipCategory : account.categoryId;

  const clipLanguage = asTrimmedString(clip.defaultLanguage);
  const defaultLanguage = clipLanguage || account.defaultLanguage || undefined;
  const clipAudio = asTrimmedString(clip.defaultAudioLanguage);
  const defaultAudioLanguage = clipAudio || defaultLanguage;

  const clipLicense = asTrimmedString(clip.license);
  const license = clipLicense === "creativeCommon" || clipLicense === "youtube" ? clipLicense : account.license;

  return {
    snippet: {
      title,
      description,
      tags,
      categoryId,
      defaultLanguage,
      defaultAudioLanguage,
    },
    status: {
      privacyStatus,
      embeddable: typeof clip.embeddable === "boolean" ? clip.embeddable : account.embeddable,
      license,
      publicStatsViewable: typeof clip.publicStatsViewable === "boolean" ? clip.publicStatsViewable : account.publicStatsViewable,
      selfDeclaredMadeForKids:
        typeof clip.selfDeclaredMadeForKids === "boolean" ? clip.selfDeclaredMadeForKids : account.selfDeclaredMadeForKids,
    },
    notifySubscribers: typeof clip.notifySubscribers === "boolean" ? clip.notifySubscribers : account.notifySubscribers,
  };
}
