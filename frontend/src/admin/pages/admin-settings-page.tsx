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
  }>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<AppSettingsPayload>("/settings");
      setPayload(data);
      const s = (data.settings?.syndication as Record<string, unknown> | undefined)?.youtube as
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
      const secretTrim = v.ytOauthClientSecret.trim();
      if (secretTrim) youtube.oauthClientSecret = secretTrim;

      const { data } = await getAdminClient().patch<AppSettingsPayload>("/settings", {
        settings: {
          syndication: {
            youtube,
          },
        },
      });
      setPayload(data);
      form.setFieldsValue({ ytOauthClientSecret: "" });
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
                      <Typography.Text strong>{t("settings.redirectUri")}:</Typography.Text>{" "}
                      <Typography.Text code>{payload.youtubeRedirectUri}</Typography.Text>
                    </Typography.Paragraph>
                  ) : null}
                  <Typography.Paragraph>
                    <Typography.Text strong>{t("settings.oauthEnv")}:</Typography.Text>{" "}
                    {payload?.youtubeOAuthConfigured ? (
                      <Typography.Text type="success">{t("settings.oauthConfigured")}</Typography.Text>
                    ) : (
                      <Typography.Text type="warning">{t("settings.oauthNotConfigured")}</Typography.Text>
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
