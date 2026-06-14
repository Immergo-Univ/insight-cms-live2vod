/**
 * Multi-account syndication: one row per authorized social account per tenant.
 */
import { randomUUID } from "crypto";

function cryptoRandomId() {
  return randomUUID();
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {typeof import("sequelize").Sequelize} Sequelize
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const tableExists = tables.includes("tenant_syndication_accounts");

  if (!tableExists) {
    await queryInterface.createTable("tenant_syndication_accounts", {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      tenant_id: {
        type: Sequelize.STRING(128),
        allowNull: false,
        references: { model: "tenants", key: "tenant_id" },
        onDelete: "CASCADE",
      },
      platform: {
        type: Sequelize.STRING(32),
        allowNull: false,
      },
      external_account_id: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      display_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      credentials: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "active",
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });
  }

  const indexes = await queryInterface.showIndex("tenant_syndication_accounts");
  const indexNames = new Set(indexes.map((idx) => idx.name));

  if (!indexNames.has("tenant_syndication_accounts_tenant_platform_idx")) {
    await queryInterface.addIndex("tenant_syndication_accounts", ["tenant_id", "platform"], {
      name: "tenant_syndication_accounts_tenant_platform_idx",
    });
  }

  if (!indexNames.has("tenant_syndication_accounts_tenant_platform_external_unique")) {
    await queryInterface.addConstraint("tenant_syndication_accounts", {
      fields: ["tenant_id", "platform", "external_account_id"],
      type: "unique",
      name: "tenant_syndication_accounts_tenant_platform_external_unique",
    });
  }

  const [existingRows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*)::int AS count FROM tenant_syndication_accounts`,
  );
  if (Number(existingRows?.[0]?.count || 0) > 0) {
    return;
  }

  const [tenants] = await queryInterface.sequelize.query(
    `SELECT * FROM tenants WHERE
      (youtube_refresh_token IS NOT NULL AND TRIM(youtube_refresh_token) <> '')
      OR (twitter_refresh_token IS NOT NULL AND TRIM(twitter_refresh_token) <> '')
      OR (facebook_user_access_token IS NOT NULL AND TRIM(facebook_user_access_token) <> '')
      OR (instagram_user_access_token IS NOT NULL AND TRIM(instagram_user_access_token) <> '')
      OR (tiktok_refresh_token IS NOT NULL AND TRIM(tiktok_refresh_token) <> '')`,
  );

  for (const row of tenants) {
    const tenantId = row.tenant_id;

    if (row.youtube_refresh_token && String(row.youtube_refresh_token).trim()) {
      await queryInterface.bulkInsert("tenant_syndication_accounts", [
        {
          id: cryptoRandomId(),
          tenant_id: tenantId,
          platform: "youtube",
          external_account_id: `legacy-youtube-${tenantId}`,
          display_name: "YouTube channel",
          credentials: JSON.stringify({ refreshToken: String(row.youtube_refresh_token).trim() }),
          status: "active",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);
    }

    if (row.twitter_refresh_token && String(row.twitter_refresh_token).trim()) {
      await queryInterface.bulkInsert("tenant_syndication_accounts", [
        {
          id: cryptoRandomId(),
          tenant_id: tenantId,
          platform: "twitter",
          external_account_id: `legacy-twitter-${tenantId}`,
          display_name: "X account",
          credentials: JSON.stringify({ refreshToken: String(row.twitter_refresh_token).trim() }),
          status: "active",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);
    }

    if (row.facebook_user_access_token && String(row.facebook_user_access_token).trim()) {
      const pageId = row.facebook_page_id && String(row.facebook_page_id).trim();
      const hasPage =
        pageId &&
        row.facebook_page_access_token &&
        String(row.facebook_page_access_token).trim();
      if (hasPage) {
        await queryInterface.bulkInsert("tenant_syndication_accounts", [
          {
            id: cryptoRandomId(),
            tenant_id: tenantId,
            platform: "facebook",
            external_account_id: pageId,
            display_name: row.facebook_page_name || pageId,
            credentials: JSON.stringify({
              userAccessToken: String(row.facebook_user_access_token).trim(),
              pageId,
              pageAccessToken: String(row.facebook_page_access_token).trim(),
              pageName: row.facebook_page_name || pageId,
            }),
            status: "active",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]);
      } else {
        const pendingId = cryptoRandomId();
        await queryInterface.bulkInsert("tenant_syndication_accounts", [
          {
            id: pendingId,
            tenant_id: tenantId,
            platform: "facebook",
            external_account_id: `pending-${pendingId}`,
            display_name: "Facebook (pending Page selection)",
            credentials: JSON.stringify({
              userAccessToken: String(row.facebook_user_access_token).trim(),
            }),
            status: "pending_selection",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]);
      }
    }

    if (row.instagram_user_access_token && String(row.instagram_user_access_token).trim()) {
      const businessId =
        row.instagram_business_account_id && String(row.instagram_business_account_id).trim();
      const hasAccount =
        businessId &&
        row.instagram_page_access_token &&
        String(row.instagram_page_access_token).trim();
      if (hasAccount) {
        await queryInterface.bulkInsert("tenant_syndication_accounts", [
          {
            id: cryptoRandomId(),
            tenant_id: tenantId,
            platform: "instagram",
            external_account_id: businessId,
            display_name: row.instagram_username || businessId,
            credentials: JSON.stringify({
              userAccessToken: String(row.instagram_user_access_token).trim(),
              businessAccountId: businessId,
              username: row.instagram_username || businessId,
              pageId: row.instagram_page_id || "",
              pageAccessToken: String(row.instagram_page_access_token).trim(),
            }),
            status: "active",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]);
      } else {
        const pendingId = cryptoRandomId();
        await queryInterface.bulkInsert("tenant_syndication_accounts", [
          {
            id: pendingId,
            tenant_id: tenantId,
            platform: "instagram",
            external_account_id: `pending-${pendingId}`,
            display_name: "Instagram (pending account selection)",
            credentials: JSON.stringify({
              userAccessToken: String(row.instagram_user_access_token).trim(),
            }),
            status: "pending_selection",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]);
      }
    }

    if (row.tiktok_refresh_token && String(row.tiktok_refresh_token).trim()) {
      const openId = row.tiktok_open_id && String(row.tiktok_open_id).trim();
      await queryInterface.bulkInsert("tenant_syndication_accounts", [
        {
          id: cryptoRandomId(),
          tenant_id: tenantId,
          platform: "tiktok",
          external_account_id: openId || `legacy-tiktok-${tenantId}`,
          display_name: row.tiktok_username || "TikTok account",
          credentials: JSON.stringify({
            refreshToken: String(row.tiktok_refresh_token).trim(),
            openId: openId || null,
            username: row.tiktok_username || null,
          }),
          status: "active",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);
    }
  }
}

/**
 * @param {import("sequelize").QueryInterface} queryInterface
 */
export async function down(queryInterface) {
  await queryInterface.dropTable("tenant_syndication_accounts");
}
