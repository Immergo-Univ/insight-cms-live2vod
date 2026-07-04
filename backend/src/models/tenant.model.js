import { DataTypes } from "sequelize";

/**
 * CMS / Live2VOD tenant (Insight customer code), keyed by tenant_id slug (e.g. rjr).
 *
 * @param {import("sequelize").Sequelize} sequelize
 */
export function registerTenantModel(sequelize) {
  if (sequelize.models.Tenant) return sequelize.models.Tenant;

  return sequelize.define(
    "Tenant",
    {
      tenantId: { type: DataTypes.STRING(128), primaryKey: true },
      /** Opt-in: only when true are this tenant's live channels probed by the AD recognition scheduler. */
      adRecognitionEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      subtitlesEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      subtitlesDefaultEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      /** Show transcript & news viewer on completed VOD encode rows. */
      subtitlesTranscriptNewsUiEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      subtitlesDefaultBurnIn: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      /** Default burn-in language code when subtitlesDefaultBurnIn is true (must be in availableLanguages). */
      subtitlesDefaultBurnInLanguage: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "en" },
      subtitlesDefaultDiarization: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      subtitlesDefaultInferSpeakerNames: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      subtitlesDefaultNewsEn: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      subtitlesDefaultNewsEs: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      subtitlesDefaultNewsHe: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      /** Pool of subtitle/news language codes enabled for this tenant (admin Languages tab). */
      availableLanguages: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: ["en", "es", "he"],
      },
      /** Show View transcript & news button in editor clip rows. */
      newsButtonEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      /** Pre-encode: news locale toggles ON by default in transcript modal. */
      newsDefaultGenerate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      syndicationYoutubeEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationYoutubeDefaultEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationYoutubeConnected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationTwitterEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationTwitterDefaultEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationTwitterConnected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationFacebookEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationFacebookDefaultEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationFacebookConnected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      /** OAuth refresh token for YouTube Data API (never exposed on public tenant DTO). */
      youtubeRefreshToken: { type: DataTypes.TEXT, allowNull: true },
      /** OAuth 2.0 refresh token for X API (never exposed on public tenant DTO). */
      twitterRefreshToken: { type: DataTypes.TEXT, allowNull: true },
      /** Long-lived Meta user access token (never exposed on public tenant DTO). */
      facebookUserAccessToken: { type: DataTypes.TEXT, allowNull: true },
      facebookPageId: { type: DataTypes.STRING(64), allowNull: true },
      facebookPageAccessToken: { type: DataTypes.TEXT, allowNull: true },
      facebookPageName: { type: DataTypes.STRING(255), allowNull: true },
      syndicationInstagramEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationInstagramConnected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      instagramUserAccessToken: { type: DataTypes.TEXT, allowNull: true },
      instagramBusinessAccountId: { type: DataTypes.STRING(64), allowNull: true },
      instagramUsername: { type: DataTypes.STRING(128), allowNull: true },
      instagramPageId: { type: DataTypes.STRING(64), allowNull: true },
      instagramPageAccessToken: { type: DataTypes.TEXT, allowNull: true },
      syndicationTiktokEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationInstagramDefaultEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationTiktokDefaultEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationTiktokConnected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      /** OAuth refresh token for TikTok Content Posting API (never exposed on public tenant DTO). */
      tiktokRefreshToken: { type: DataTypes.TEXT, allowNull: true },
      tiktokOpenId: { type: DataTypes.STRING(64), allowNull: true },
      tiktokUsername: { type: DataTypes.STRING(128), allowNull: true },
      /** Max authorized syndication accounts per platform (JSONB map, default 5 in app code). */
      syndicationAccountMaxByPlatform: { type: DataTypes.JSONB, allowNull: true },
      timezoneLastSeen: { type: DataTypes.STRING(128), allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: true },
      firstSeenAt: { type: DataTypes.DATE, allowNull: true },
      lastSeenAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "tenants", underscored: true, timestamps: true },
  );
}
