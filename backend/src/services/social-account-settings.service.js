/**
 * Facebook, Instagram, X and TikTok publish defaults stored on a syndication account.
 * Each normalizer only keeps fields the matching upload call actually sends.
 */

import {
  appendHashtags,
  applyTextTemplate,
  asTrimmedString,
  normalizeHashtags,
} from "./syndication-text-template.service.js";

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function asRecord(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 */
function asBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

// --- Facebook (Page /videos: title, description) ---

/**
 * @param {unknown} raw
 */
export function normalizeFacebookAccountSettings(raw) {
  const src = asRecord(raw);
  return {
    titleTemplate: asTrimmedString(src.titleTemplate) || "{title}",
    descriptionTemplate: asTrimmedString(src.descriptionTemplate) || "{short_description}",
    hashtags: normalizeHashtags(src.hashtags),
  };
}

/**
 * @param {unknown} settings
 * @param {Record<string, unknown>} opt
 * @param {{ title?: string, description?: string }} meta
 */
export function resolveFacebookPublishOptions(settings, opt, meta) {
  const account = normalizeFacebookAccountSettings(settings);
  const clip = asRecord(opt);
  const title =
    asTrimmedString(clip.titleOverride) ||
    applyTextTemplate(account.titleTemplate, meta) ||
    asTrimmedString(meta?.title) ||
    "Untitled";
  const baseDescription =
    asTrimmedString(clip.descriptionOverride) ||
    applyTextTemplate(account.descriptionTemplate, meta) ||
    asTrimmedString(meta?.description);
  return { title, description: appendHashtags(baseDescription, account.hashtags) };
}

// --- Instagram (media container: caption, media_type, share_to_feed) ---

/**
 * @param {unknown} raw
 */
export function normalizeInstagramAccountSettings(raw) {
  const src = asRecord(raw);
  return {
    captionTemplate: asTrimmedString(src.captionTemplate) || "{title}\n\n{short_description}",
    hashtags: normalizeHashtags(src.hashtags),
    mediaType: src.mediaType === "feed" ? "feed" : "reels",
    shareToFeed: asBool(src.shareToFeed, true),
  };
}

/**
 * @param {unknown} settings
 * @param {Record<string, unknown>} opt
 * @param {{ title?: string, description?: string }} meta
 */
export function resolveInstagramPublishOptions(settings, opt, meta) {
  const account = normalizeInstagramAccountSettings(settings);
  const clip = asRecord(opt);
  const baseCaption = asTrimmedString(clip.captionOverride) || applyTextTemplate(account.captionTemplate, meta);
  const caption = appendHashtags(baseCaption, account.hashtags) || " ";
  const clipMediaType = asTrimmedString(clip.mediaType).toLowerCase();
  const mediaType = clipMediaType === "feed" || clipMediaType === "reels" ? clipMediaType : account.mediaType;
  return { caption, mediaType, shareToFeed: account.shareToFeed };
}

// --- X (POST /2/tweets: text, reply_settings) ---

const TWITTER_REPLY_SETTINGS = new Set(["everyone", "following", "mentionedUsers"]);

/**
 * @param {unknown} raw
 */
export function normalizeTwitterAccountSettings(raw) {
  const src = asRecord(raw);
  const replySettings = asTrimmedString(src.replySettings);
  return {
    textTemplate: asTrimmedString(src.textTemplate) || "{title}",
    hashtags: normalizeHashtags(src.hashtags, 10),
    replySettings: TWITTER_REPLY_SETTINGS.has(replySettings) ? replySettings : "everyone",
  };
}

/**
 * @param {unknown} settings
 * @param {Record<string, unknown>} opt
 * @param {{ title?: string, description?: string }} meta
 */
export function resolveTwitterPublishOptions(settings, opt, meta) {
  const account = normalizeTwitterAccountSettings(settings);
  const clip = asRecord(opt);
  const baseText =
    asTrimmedString(clip.textOverride) || applyTextTemplate(account.textTemplate, meta) || asTrimmedString(meta?.title);
  return {
    text: appendHashtags(baseText, account.hashtags) || " ",
    replySettings: account.replySettings === "everyone" ? undefined : account.replySettings,
  };
}

// --- TikTok (Direct Post post_info) ---

const TIKTOK_PRIVACY_LEVELS = new Set([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

const TIKTOK_DISCLOSURES = new Set(["none", "your_brand", "branded_content"]);

/**
 * @param {unknown} raw
 * @param {{ defaultCaption?: string, defaultPrivacyLevel?: string }} [adminDefaults]
 */
export function normalizeTiktokAccountSettings(raw, adminDefaults = {}) {
  const src = asRecord(raw);
  const privacy = asTrimmedString(src.privacyLevel);
  const adminPrivacy = asTrimmedString(adminDefaults.defaultPrivacyLevel);
  const disclosure = asTrimmedString(src.disclosure);
  return {
    captionTemplate: asTrimmedString(src.captionTemplate) || "{title}\n\n{short_description}",
    hashtags: normalizeHashtags(src.hashtags),
    privacyLevel: TIKTOK_PRIVACY_LEVELS.has(privacy)
      ? privacy
      : TIKTOK_PRIVACY_LEVELS.has(adminPrivacy)
        ? adminPrivacy
        : "SELF_ONLY",
    allowComments: asBool(src.allowComments, true),
    allowDuet: asBool(src.allowDuet, true),
    allowStitch: asBool(src.allowStitch, true),
    disclosure: TIKTOK_DISCLOSURES.has(disclosure) ? disclosure : "none",
    aiGenerated: asBool(src.aiGenerated, false),
  };
}

/**
 * Clip toggles can only restrict further (disable) or add a disclosure; they never re-enable.
 *
 * @param {unknown} settings
 * @param {Record<string, unknown>} opt
 * @param {{ title?: string, description?: string }} meta
 * @param {{ defaultCaption?: string, defaultPrivacyLevel?: string }} [adminDefaults]
 */
export function resolveTiktokPublishOptions(settings, opt, meta, adminDefaults = {}) {
  const account = normalizeTiktokAccountSettings(settings, adminDefaults);
  const clip = asRecord(opt);
  const baseCaption =
    asTrimmedString(clip.captionOverride) ||
    applyTextTemplate(account.captionTemplate, meta) ||
    asTrimmedString(adminDefaults.defaultCaption);
  const clipPrivacy = asTrimmedString(clip.privacyLevel);
  return {
    caption: appendHashtags(baseCaption, account.hashtags) || " ",
    privacyLevel: TIKTOK_PRIVACY_LEVELS.has(clipPrivacy) ? clipPrivacy : account.privacyLevel,
    disableComment: clip.disableComment === true || !account.allowComments,
    disableDuet: clip.disableDuet === true || !account.allowDuet,
    disableStitch: clip.disableStitch === true || !account.allowStitch,
    brandOrganicToggle: clip.brandOrganicToggle === true || account.disclosure === "your_brand",
    brandContentToggle: clip.brandContentToggle === true || account.disclosure === "branded_content",
    isAigc: account.aiGenerated,
  };
}
