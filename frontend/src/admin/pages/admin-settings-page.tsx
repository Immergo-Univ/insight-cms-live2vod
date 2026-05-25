import { useCallback, useEffect, useState } from "react";
import { UploadOutlined } from "@ant-design/icons";
import { App, Button, Collapse, Form, Input, Select, Spin, Switch, Tabs, Typography, Upload } from "antd";
import type { UploadProps } from "antd";
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

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function saveErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "errorFields" in e) {
    const fields = (e as { errorFields?: { errors: string[] }[] }).errorFields;
    const first = fields?.[0]?.errors?.[0];
    if (first) return first;
  }
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err.response?.data?.error || err.message || fallback;
}

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
    ttDomainVerificationPath: string;
    ttDomainVerificationFileContent: string;
    ttDomainVerificationContentType: string;
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
        ttDomainVerificationPath:
          typeof tt?.domainVerificationPath === "string" ? tt.domainVerificationPath : "",
        ttDomainVerificationFileContent:
          typeof tt?.domainVerificationFileContent === "string" ? tt.domainVerificationFileContent : "",
        ttDomainVerificationContentType:
          typeof tt?.domainVerificationContentType === "string" && tt.domainVerificationContentType.trim()
            ? tt.domainVerificationContentType
            : "text/plain; charset=utf-8",
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
    let v: Awaited<ReturnType<typeof form.validateFields>>;
    try {
      v = await form.validateFields();
    } catch (e: unknown) {
      message.error(saveErrorMessage(e, t("settings.validationFailed")));
      return;
    }
    setSaving(true);
    try {
      const youtube: Record<string, unknown> = {
        oauthClientId: asTrimmedString(v.ytOauthClientId),
        oauthRedirectUri: asTrimmedString(v.ytOauthRedirectUri),
        defaultPrivacy: v.ytDefaultPrivacy ?? "private",
        defaultCategoryId: asTrimmedString(v.ytCategoryId) || "22",
        defaultEmbeddable: v.ytEmbeddable !== false,
        defaultMadeForKids: Boolean(v.ytMadeForKids),
        defaultLicense: v.ytLicense ?? "youtube",
        defaultNotifySubscribers: Boolean(v.ytNotifySubscribers),
        defaultPublicStatsViewable: v.ytPublicStats !== false,
      };
      const secretYtTrim = asTrimmedString(v.ytOauthClientSecret);
      if (secretYtTrim) youtube.oauthClientSecret = secretYtTrim;

      const twitter: Record<string, unknown> = {
        oauthClientId: asTrimmedString(v.twOauthClientId),
        oauthRedirectUri: asTrimmedString(v.twOauthRedirectUri),
        defaultTweetText: asTrimmedString(v.twDefaultTweetText),
      };
      const secretTwTrim = asTrimmedString(v.twOauthClientSecret);
      if (secretTwTrim) twitter.oauthClientSecret = secretTwTrim;

      const facebook: Record<string, unknown> = {
        oauthClientId: asTrimmedString(v.fbOauthClientId),
        oauthRedirectUri: asTrimmedString(v.fbOauthRedirectUri),
        defaultDescription: asTrimmedString(v.fbDefaultDescription),
      };
      const secretFbTrim = asTrimmedString(v.fbOauthClientSecret);
      if (secretFbTrim) facebook.oauthClientSecret = secretFbTrim;

      const instagram: Record<string, unknown> = {
        oauthClientId: asTrimmedString(v.igOauthClientId),
        oauthRedirectUri: asTrimmedString(v.igOauthRedirectUri),
        defaultCaption: asTrimmedString(v.igDefaultCaption),
      };
      const secretIgTrim = asTrimmedString(v.igOauthClientSecret);
      if (secretIgTrim) instagram.oauthClientSecret = secretIgTrim;

      const tiktok: Record<string, unknown> = {
        oauthClientKey: asTrimmedString(v.ttOauthClientKey),
        oauthRedirectUri: asTrimmedString(v.ttOauthRedirectUri),
        defaultPrivacyLevel: asTrimmedString(v.ttDefaultPrivacyLevel) || "SELF_ONLY",
        defaultCaption: asTrimmedString(v.ttDefaultCaption),
        domainVerificationPath: asTrimmedString(v.ttDomainVerificationPath),
        domainVerificationFileContent: v.ttDomainVerificationFileContent ?? "",
        domainVerificationContentType:
          asTrimmedString(v.ttDomainVerificationContentType) || "text/plain; charset=utf-8",
      };
      const secretTtTrim = asTrimmedString(v.ttOauthClientSecret);
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
      message.error(saveErrorMessage(e, t("settings.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const tiktokVerificationUploadProps: UploadProps = {
    accept: ".txt,text/plain",
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const text = await file.text();
        const currentPath = asTrimmedString(form.getFieldValue("ttDomainVerificationPath"));
        if (!currentPath) {
          const normalizedName = file.name.replace(/^\/+/, "");
          form.setFieldValue("ttDomainVerificationPath", `/${normalizedName}`);
        }
        form.setFieldValue("ttDomainVerificationFileContent", text);
        if (!asTrimmedString(form.getFieldValue("ttDomainVerificationContentType"))) {
          form.setFieldValue("ttDomainVerificationContentType", "text/plain; charset=utf-8");
        }
        message.success(t("settings.ttDomainVerificationUploadLoaded", { fileName: file.name }));
      } catch {
        message.error(t("settings.ttDomainVerificationUploadFailed"));
      }
      return false;
    },
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
                  <Form
                    form={form}
                    layout="vertical"
                    disabled={!can("settings", "edit")}
                    onFinish={() => void save()}
                  >
                  <Collapse
                    defaultActiveKey={["youtube"]}
                    items={[
                      {
                        key: "youtube",
                        forceRender: true,
                        label: t("settings.youtubePanelTitle"),
                        children: (
                          <>
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
                          </>
                        ),
                      },
                      {
                        key: "twitter",
                        forceRender: true,
                        label: t("settings.twitterPanelTitle"),
                        children: (
                          <>
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
                          </>
                        ),
                      },
                      {
                        key: "facebook",
                        forceRender: true,
                        label: t("settings.facebookPanelTitle"),
                        children: (
                          <>
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
                          </>
                        ),
                      },
                      {
                        key: "instagram",
                        forceRender: true,
                        label: t("settings.instagramPanelTitle"),
                        children: (
                          <>
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
                          </>
                        ),
                      },
                      {
                        key: "tiktok",
                        forceRender: true,
                        label: t("settings.tiktokPanelTitle"),
                        children: (
                          <>
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
                            <Form.Item
                              name="ttDomainVerificationPath"
                              label={t("settings.ttDomainVerificationPath")}
                              rules={[
                                {
                                  validator: async (_, value: unknown) => {
                                    const path = asTrimmedString(value);
                                    if (!path) return;
                                    if (!path.startsWith("/")) {
                                      throw new Error(t("settings.ttDomainVerificationPathError"));
                                    }
                                  },
                                },
                              ]}
                            >
                              <Input placeholder="/.well-known/tiktok-domain-verification.txt" />
                            </Form.Item>
                            <Form.Item
                              name="ttDomainVerificationContentType"
                              label={t("settings.ttDomainVerificationContentType")}
                            >
                              <Input placeholder="text/plain; charset=utf-8" />
                            </Form.Item>
                            <Form.Item label={t("settings.ttDomainVerificationUpload")}>
                              <Upload {...tiktokVerificationUploadProps}>
                                <Button icon={<UploadOutlined />}>{t("settings.ttDomainVerificationUploadCta")}</Button>
                              </Upload>
                            </Form.Item>
                            <Form.Item
                              name="ttDomainVerificationFileContent"
                              label={t("settings.ttDomainVerificationFileContent")}
                            >
                              <Input.TextArea rows={8} placeholder="Paste the exact verification file content here" />
                            </Form.Item>
                          </>
                        ),
                      },
                    ]}
                  />
                  {can("settings", "edit") ? (
                    <Button type="primary" htmlType="submit" loading={saving} style={{ marginTop: 16 }}>
                      {t("common.save")}
                    </Button>
                  ) : null}
                  </Form>
                </div>
              ),
            },
          ]}
        />
      </Spin>
    </div>
  );
}
