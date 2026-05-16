import { useCallback, useEffect, useState } from "react";
import { App, Button, Collapse, Form, Input, Select, Spin, Switch, Tabs, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth-context";

type AppSettingsPayload = {
  settings: Record<string, unknown>;
  youtubeOAuthConfigured?: boolean;
  youtubeRedirectUri?: string | null;
  youtubeDbClientSecretSet?: boolean;
  twitterOAuthConfigured?: boolean;
  twitterRedirectUri?: string | null;
  twitterDbClientSecretSet?: boolean;
  facebookOAuthConfigured?: boolean;
  facebookRedirectUri?: string | null;
  facebookDbClientSecretSet?: boolean;
  instagramOAuthConfigured?: boolean;
  instagramRedirectUri?: string | null;
  instagramDbClientSecretSet?: boolean;
  tiktokOAuthConfigured?: boolean;
  tiktokRedirectUri?: string | null;
  tiktokDbClientSecretSet?: boolean;
};

export function AdminSettingsPage() {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const { can } = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payload, setPayload] = useState<AppSettingsPayload | null>(null);
  const [form] = Form.useForm<{
    ytOauthClientId: string;
    ytOauthRedirectUri: string;
    ytOauthClientSecret: string;
    ytDefaultPrivacy: string;
    ytCategoryId: string;
    ytEmbeddable: boolean;
    ytMadeForKids: boolean;
    ytLicense: string;
    ytNotifySubscribers: boolean;
    ytPublicStats: boolean;
    twOauthClientId: string;
    twOauthRedirectUri: string;
    twOauthClientSecret: string;
    twDefaultTweetText: string;
    fbOauthClientId: string;
    fbOauthRedirectUri: string;
    fbOauthClientSecret: string;
    fbDefaultDescription: string;
    igOauthClientId: string;
    igOauthRedirectUri: string;
    igOauthClientSecret: string;
    igDefaultCaption: string;
    ttOauthClientKey: string;
    ttOauthRedirectUri: string;
    ttOauthClientSecret: string;
    ttDefaultPrivacyLevel: string;
    ttDefaultCaption: string;
  }>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<AppSettingsPayload>("/settings");
      setPayload(data);
      const s = (data.settings?.syndication as Record<string, unknown> | undefined)?.youtube as
        | Record<string, unknown>
        | undefined;
      const tw = (data.settings?.syndication as Record<string, unknown> | undefined)?.twitter as
        | Record<string, unknown>
        | undefined;
      const fb = (data.settings?.syndication as Record<string, unknown> | undefined)?.facebook as
        | Record<string, unknown>
        | undefined;
      const ig = (data.settings?.syndication as Record<string, unknown> | undefined)?.instagram as
        | Record<string, unknown>
        | undefined;
      const tt = (data.settings?.syndication as Record<string, unknown> | undefined)?.tiktok as
        | Record<string, unknown>
        | undefined;
      form.setFieldsValue({
        ytOauthClientId: typeof s?.oauthClientId === "string" ? s.oauthClientId : "",
        ytOauthRedirectUri: typeof s?.oauthRedirectUri === "string" ? s.oauthRedirectUri : "",
        ytOauthClientSecret: "",
        ytDefaultPrivacy: typeof s?.defaultPrivacy === "string" ? s.defaultPrivacy : "private",
        ytCategoryId: String(s?.defaultCategoryId ?? "22"),
        ytEmbeddable: s?.defaultEmbeddable !== false,
        ytMadeForKids: Boolean(s?.defaultMadeForKids),
        ytLicense: typeof s?.defaultLicense === "string" ? s.defaultLicense : "youtube",
        ytNotifySubscribers: Boolean(s?.defaultNotifySubscribers),
        ytPublicStats: s?.defaultPublicStatsViewable !== false,
        twOauthClientId: typeof tw?.oauthClientId === "string" ? tw.oauthClientId : "",
        twOauthRedirectUri: typeof tw?.oauthRedirectUri === "string" ? tw.oauthRedirectUri : "",
        twOauthClientSecret: "",
        twDefaultTweetText: typeof tw?.defaultTweetText === "string" ? tw.defaultTweetText : "",
        fbOauthClientId: typeof fb?.oauthClientId === "string" ? fb.oauthClientId : "",
        fbOauthRedirectUri: typeof fb?.oauthRedirectUri === "string" ? fb.oauthRedirectUri : "",
        fbOauthClientSecret: "",
        fbDefaultDescription: typeof fb?.defaultDescription === "string" ? fb.defaultDescription : "",
        igOauthClientId: typeof ig?.oauthClientId === "string" ? ig.oauthClientId : "",
        igOauthRedirectUri: typeof ig?.oauthRedirectUri === "string" ? ig.oauthRedirectUri : "",
        igOauthClientSecret: "",
        igDefaultCaption: typeof ig?.defaultCaption === "string" ? ig.defaultCaption : "",
        ttOauthClientKey: typeof tt?.oauthClientKey === "string" ? tt.oauthClientKey : "",
        ttOauthRedirectUri: typeof tt?.oauthRedirectUri === "string" ? tt.oauthRedirectUri : "",
        ttOauthClientSecret: "",
        ttDefaultPrivacyLevel:
          typeof tt?.defaultPrivacyLevel === "string" ? tt.defaultPrivacyLevel : "SELF_ONLY",
        ttDefaultCaption: typeof tt?.defaultCaption === "string" ? tt.defaultCaption : "",
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setLoading(false);
    }
  }, [form, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!can("settings", "edit")) return;
    const v = await form.validateFields();
    setSaving(true);
    try {
      const youtube: Record<string, unknown> = {
        oauthClientId: v.ytOauthClientId.trim(),
        oauthRedirectUri: v.ytOauthRedirectUri.trim(),
        defaultPrivacy: v.ytDefaultPrivacy,
        defaultCategoryId: v.ytCategoryId.trim() || "22",
        defaultEmbeddable: v.ytEmbeddable,
        defaultMadeForKids: v.ytMadeForKids,
        defaultLicense: v.ytLicense,
        defaultNotifySubscribers: v.ytNotifySubscribers,
        defaultPublicStatsViewable: v.ytPublicStats,
      };
      const secretYtTrim = v.ytOauthClientSecret.trim();
      if (secretYtTrim) youtube.oauthClientSecret = secretYtTrim;

      const twitter: Record<string, unknown> = {
        oauthClientId: v.twOauthClientId.trim(),
        oauthRedirectUri: v.twOauthRedirectUri.trim(),
        defaultTweetText: v.twDefaultTweetText.trim(),
      };
      const secretTwTrim = v.twOauthClientSecret.trim();
      if (secretTwTrim) twitter.oauthClientSecret = secretTwTrim;

      const facebook: Record<string, unknown> = {
        oauthClientId: v.fbOauthClientId.trim(),
        oauthRedirectUri: v.fbOauthRedirectUri.trim(),
        defaultDescription: v.fbDefaultDescription.trim(),
      };
      const secretFbTrim = v.fbOauthClientSecret.trim();
      if (secretFbTrim) facebook.oauthClientSecret = secretFbTrim;

      const instagram: Record<string, unknown> = {
        oauthClientId: v.igOauthClientId.trim(),
        oauthRedirectUri: v.igOauthRedirectUri.trim(),
        defaultCaption: v.igDefaultCaption.trim(),
      };
      const secretIgTrim = v.igOauthClientSecret.trim();
      if (secretIgTrim) instagram.oauthClientSecret = secretIgTrim;

      const tiktok: Record<string, unknown> = {
        oauthClientKey: v.ttOauthClientKey.trim(),
        oauthRedirectUri: v.ttOauthRedirectUri.trim(),
        defaultPrivacyLevel: v.ttDefaultPrivacyLevel.trim() || "SELF_ONLY",
        defaultCaption: v.ttDefaultCaption.trim(),
      };
      const secretTtTrim = v.ttOauthClientSecret.trim();
      if (secretTtTrim) tiktok.oauthClientSecret = secretTtTrim;

      const { data } = await getAdminClient().patch<AppSettingsPayload>("/settings", {
        settings: {
          syndication: {
            youtube,
            twitter,
            facebook,
            instagram,
            tiktok,
          },
        },
      });
      setPayload(data);
      form.setFieldsValue({
        ytOauthClientSecret: "",
        twOauthClientSecret: "",
        fbOauthClientSecret: "",
        igOauthClientSecret: "",
        ttOauthClientSecret: "",
      });
      message.success(t("settings.saved"));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t("settings.title")}
      </Typography.Title>
      <Spin spinning={loading}>
        <Tabs
          defaultActiveKey="syndication"
          items={[
            {
              key: "syndication",
              label: t("settings.tabSyndication"),
              children: (
                <div style={{ maxWidth: 720 }}>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    {t("settings.syndicationIntro")}
                  </Typography.Paragraph>
                  {payload?.youtubeRedirectUri ? (
                    <Typography.Paragraph>
                      <Typography.Text strong>{t("settings.youtubeRedirectUriLabel")}:</Typography.Text>{" "}
                      <Typography.Text code>{payload.youtubeRedirectUri}</Typography.Text>
                    </Typography.Paragraph>
                  ) : null}
                  {payload?.twitterRedirectUri ? (
                    <Typography.Paragraph>
                      <Typography.Text strong>{t("settings.twitterRedirectUriLabel")}:</Typography.Text>{" "}
                      <Typography.Text code>{payload.twitterRedirectUri}</Typography.Text>
                    </Typography.Paragraph>
                  ) : null}
                  {payload?.facebookRedirectUri ? (
                    <Typography.Paragraph>
                      <Typography.Text strong>{t("settings.facebookRedirectUriLabel")}:</Typography.Text>{" "}
                      <Typography.Text code>{payload.facebookRedirectUri}</Typography.Text>
                    </Typography.Paragraph>
                  ) : null}
                  {payload?.instagramRedirectUri ? (
                    <Typography.Paragraph>
                      <Typography.Text strong>{t("settings.instagramRedirectUriLabel")}:</Typography.Text>{" "}
                      <Typography.Text code>{payload.instagramRedirectUri}</Typography.Text>
                    </Typography.Paragraph>
                  ) : null}
                  {payload?.tiktokRedirectUri ? (
                    <Typography.Paragraph>
                      <Typography.Text strong>{t("settings.tiktokRedirectUriLabel")}:</Typography.Text>{" "}
                      <Typography.Text code>{payload.tiktokRedirectUri}</Typography.Text>
                    </Typography.Paragraph>
                  ) : null}
                  <Typography.Paragraph>
                    <Typography.Text strong>{t("settings.oauthEnvYoutube")}:</Typography.Text>{" "}
                    {payload?.youtubeOAuthConfigured ? (
                      <Typography.Text type="success">{t("settings.oauthConfigured")}</Typography.Text>
                    ) : (
                      <Typography.Text type="warning">{t("settings.oauthNotConfiguredYoutube")}</Typography.Text>
                    )}
                  </Typography.Paragraph>
                  <Typography.Paragraph>
                    <Typography.Text strong>{t("settings.oauthEnvTwitter")}:</Typography.Text>{" "}
                    {payload?.twitterOAuthConfigured ? (
                      <Typography.Text type="success">{t("settings.oauthConfigured")}</Typography.Text>
                    ) : (
                      <Typography.Text type="warning">{t("settings.oauthNotConfiguredTwitter")}</Typography.Text>
                    )}
                  </Typography.Paragraph>
                  <Typography.Paragraph>
                    <Typography.Text strong>{t("settings.oauthEnvFacebook")}:</Typography.Text>{" "}
                    {payload?.facebookOAuthConfigured ? (
                      <Typography.Text type="success">{t("settings.oauthConfigured")}</Typography.Text>
                    ) : (
                      <Typography.Text type="warning">{t("settings.oauthNotConfiguredFacebook")}</Typography.Text>
                    )}
                  </Typography.Paragraph>
                  <Typography.Paragraph>
                    <Typography.Text strong>{t("settings.oauthEnvInstagram")}:</Typography.Text>{" "}
                    {payload?.instagramOAuthConfigured ? (
                      <Typography.Text type="success">{t("settings.oauthConfigured")}</Typography.Text>
                    ) : (
                      <Typography.Text type="warning">{t("settings.oauthNotConfiguredInstagram")}</Typography.Text>
                    )}
                  </Typography.Paragraph>
                  <Typography.Paragraph>
                    <Typography.Text strong>{t("settings.oauthEnvTiktok")}:</Typography.Text>{" "}
                    {payload?.tiktokOAuthConfigured ? (
                      <Typography.Text type="success">{t("settings.oauthConfigured")}</Typography.Text>
                    ) : (
                      <Typography.Text type="warning">{t("settings.oauthNotConfiguredTiktok")}</Typography.Text>
                    )}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    {t("settings.oauthEnvWhereHint")}
                  </Typography.Paragraph>
                  <Collapse
                    defaultActiveKey={["youtube"]}
                    items={[
                      {
                        key: "youtube",
                        label: t("settings.youtubePanelTitle"),
                        children: (
                          <Form form={form} layout="vertical" disabled={!can("settings", "edit")}>
                            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                              {t("settings.oauthYoutubeBlockIntro")}
                            </Typography.Text>
                            <Form.Item name="ytOauthClientId" label={t("settings.ytOauthClientId")}>
                              <Input autoComplete="off" />
                            </Form.Item>
                            <Form.Item name="ytOauthRedirectUri" label={t("settings.ytOauthRedirectUri")}>
                              <Input autoComplete="off" placeholder="https://api.example.com/api/tenants/oauth/youtube/callback" />
                            </Form.Item>
                            {payload?.youtubeDbClientSecretSet ? (
                              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                                {t("settings.ytOauthClientSecretSavedDb")}
                              </Typography.Paragraph>
                            ) : null}
                            <Form.Item
                              name="ytOauthClientSecret"
                              label={t("settings.ytOauthClientSecret")}
                              extra={
                                <span style={{ maxWidth: 640, display: "inline-block" }}>
                                  {t("settings.ytOauthClientSecretExtra")}
                                </span>
                              }
                            >
                              <Input.Password autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item name="ytDefaultPrivacy" label={t("settings.ytDefaultPrivacy")}>
                              <Select
                                options={[
                                  { value: "private", label: "Private" },
                                  { value: "unlisted", label: "Unlisted" },
                                  { value: "public", label: "Public" },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="ytCategoryId" label={t("settings.ytCategoryId")}>
                              <Input />
                            </Form.Item>
                            <Form.Item name="ytLicense" label={t("settings.ytLicense")}>
                              <Select
                                options={[
                                  { value: "youtube", label: "Standard YouTube" },
                                  { value: "creativeCommon", label: "Creative Commons" },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="ytEmbeddable" label={t("settings.ytEmbeddable")} valuePropName="checked">
                              <Switch />
                            </Form.Item>
                            <Form.Item name="ytPublicStats" label={t("settings.ytPublicStats")} valuePropName="checked">
                              <Switch />
                            </Form.Item>
                            <Form.Item name="ytMadeForKids" label={t("settings.ytMadeForKids")} valuePropName="checked">
                              <Switch />
                            </Form.Item>
                            <Form.Item
                              name="ytNotifySubscribers"
                              label={t("settings.ytNotifySubscribers")}
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Form>
                        ),
                      },
                      {
                        key: "twitter",
                        label: t("settings.twitterPanelTitle"),
                        children: (
                          <Form form={form} layout="vertical" disabled={!can("settings", "edit")}>
                            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                              {t("settings.oauthTwitterBlockIntro")}
                            </Typography.Text>
                            <Form.Item name="twOauthClientId" label={t("settings.twOauthClientId")}>
                              <Input autoComplete="off" />
                            </Form.Item>
                            <Form.Item name="twOauthRedirectUri" label={t("settings.twOauthRedirectUri")}>
                              <Input
                                autoComplete="off"
                                placeholder="https://api.example.com/api/tenants/oauth/twitter/callback"
                              />
                            </Form.Item>
                            {payload?.twitterDbClientSecretSet ? (
                              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                                {t("settings.twOauthClientSecretSavedDb")}
                              </Typography.Paragraph>
                            ) : null}
                            <Form.Item
                              name="twOauthClientSecret"
                              label={t("settings.twOauthClientSecret")}
                              extra={
                                <span style={{ maxWidth: 640, display: "inline-block" }}>
                                  {t("settings.twOauthClientSecretExtra")}
                                </span>
                              }
                            >
                              <Input.Password autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item name="twDefaultTweetText" label={t("settings.twDefaultTweetText")}>
                              <Input.TextArea rows={2} placeholder="" />
                            </Form.Item>
                          </Form>
                        ),
                      },
                      {
                        key: "facebook",
                        label: t("settings.facebookPanelTitle"),
                        children: (
                          <Form form={form} layout="vertical" disabled={!can("settings", "edit")}>
                            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                              {t("settings.oauthFacebookBlockIntro")}
                            </Typography.Text>
                            <Form.Item name="fbOauthClientId" label={t("settings.fbOauthClientId")}>
                              <Input autoComplete="off" />
                            </Form.Item>
                            <Form.Item name="fbOauthRedirectUri" label={t("settings.fbOauthRedirectUri")}>
                              <Input
                                autoComplete="off"
                                placeholder="https://api.example.com/api/tenants/oauth/facebook/callback"
                              />
                            </Form.Item>
                            {payload?.facebookDbClientSecretSet ? (
                              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                                {t("settings.fbOauthClientSecretSavedDb")}
                              </Typography.Paragraph>
                            ) : null}
                            <Form.Item
                              name="fbOauthClientSecret"
                              label={t("settings.fbOauthClientSecret")}
                              extra={
                                <span style={{ maxWidth: 640, display: "inline-block" }}>
                                  {t("settings.fbOauthClientSecretExtra")}
                                </span>
                              }
                            >
                              <Input.Password autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item name="fbDefaultDescription" label={t("settings.fbDefaultDescription")}>
                              <Input.TextArea rows={2} placeholder="" />
                            </Form.Item>
                          </Form>
                        ),
                      },
                      {
                        key: "instagram",
                        label: t("settings.instagramPanelTitle"),
                        children: (
                          <Form form={form} layout="vertical" disabled={!can("settings", "edit")}>
                            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                              {t("settings.oauthInstagramBlockIntro")}
                            </Typography.Text>
                            <Form.Item name="igOauthClientId" label={t("settings.igOauthClientId")}>
                              <Input autoComplete="off" />
                            </Form.Item>
                            <Form.Item name="igOauthRedirectUri" label={t("settings.igOauthRedirectUri")}>
                              <Input
                                autoComplete="off"
                                placeholder="https://api.example.com/api/tenants/oauth/instagram/callback"
                              />
                            </Form.Item>
                            {payload?.instagramDbClientSecretSet ? (
                              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                                {t("settings.igOauthClientSecretSavedDb")}
                              </Typography.Paragraph>
                            ) : null}
                            <Form.Item
                              name="igOauthClientSecret"
                              label={t("settings.igOauthClientSecret")}
                              extra={
                                <span style={{ maxWidth: 640, display: "inline-block" }}>
                                  {t("settings.igOauthClientSecretExtra")}
                                </span>
                              }
                            >
                              <Input.Password autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item name="igDefaultCaption" label={t("settings.igDefaultCaption")}>
                              <Input.TextArea rows={2} placeholder="" />
                            </Form.Item>
                          </Form>
                        ),
                      },
                      {
                        key: "tiktok",
                        label: t("settings.tiktokPanelTitle"),
                        children: (
                          <Form form={form} layout="vertical" disabled={!can("settings", "edit")}>
                            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                              {t("settings.oauthTiktokBlockIntro")}
                            </Typography.Text>
                            <Form.Item name="ttOauthClientKey" label={t("settings.ttOauthClientKey")}>
                              <Input autoComplete="off" />
                            </Form.Item>
                            <Form.Item name="ttOauthRedirectUri" label={t("settings.ttOauthRedirectUri")}>
                              <Input
                                autoComplete="off"
                                placeholder="https://api.example.com/api/tenants/oauth/tiktok/callback"
                              />
                            </Form.Item>
                            {payload?.tiktokDbClientSecretSet ? (
                              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                                {t("settings.ttOauthClientSecretSavedDb")}
                              </Typography.Paragraph>
                            ) : null}
                            <Form.Item
                              name="ttOauthClientSecret"
                              label={t("settings.ttOauthClientSecret")}
                              extra={
                                <span style={{ maxWidth: 640, display: "inline-block" }}>
                                  {t("settings.ttOauthClientSecretExtra")}
                                </span>
                              }
                            >
                              <Input.Password autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item name="ttDefaultPrivacyLevel" label={t("settings.ttDefaultPrivacyLevel")}>
                              <Select
                                options={[
                                  { value: "SELF_ONLY", label: "Self only" },
                                  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Mutual follow friends" },
                                  { value: "FOLLOWER_OF_CREATOR", label: "Follower of creator" },
                                  { value: "PUBLIC_TO_EVERYONE", label: "Public to everyone" },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="ttDefaultCaption" label={t("settings.ttDefaultCaption")}>
                              <Input.TextArea rows={2} placeholder="" />
                            </Form.Item>
                          </Form>
                        ),
                      },
                    ]}
                  />
                  {can("settings", "edit") ? (
                    <Button type="primary" loading={saving} onClick={() => void save()} style={{ marginTop: 16 }}>
                      {t("common.save")}
                    </Button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </Spin>
    </div>
  );
}
