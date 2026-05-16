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
      subtitlesEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      syndicationYoutubeEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationYoutubeConnected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationTwitterEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationTwitterConnected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      syndicationFacebookEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
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
      syndicationTiktokConnected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      /** OAuth refresh token for TikTok Content Posting API (never exposed on public tenant DTO). */
      tiktokRefreshToken: { type: DataTypes.TEXT, allowNull: true },
      tiktokOpenId: { type: DataTypes.STRING(64), allowNull: true },
      tiktokUsername: { type: DataTypes.STRING(128), allowNull: true },
      timezoneLastSeen: { type: DataTypes.STRING(128), allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: true },
      firstSeenAt: { type: DataTypes.DATE, allowNull: true },
      lastSeenAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "tenants", underscored: true, timestamps: true },
  );
}
