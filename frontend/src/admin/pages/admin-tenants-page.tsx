import { useCallback, useEffect, useState } from "react";
import { App, Button, Dropdown, Form, Input, Modal, Popconfirm, Space, Spin, Switch, Table, Tag, Typography } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth-context";

type TenantRow = {
  tenantId: string;
  subtitlesEnabled: boolean;
  syndicationYoutubeEnabled: boolean;
  syndicationYoutubeConnected?: boolean;
  syndicationTwitterEnabled: boolean;
  syndicationTwitterConnected?: boolean;
  syndicationFacebookEnabled: boolean;
  syndicationFacebookConnected?: boolean;
  facebookPageName?: string | null;
  syndicationInstagramEnabled: boolean;
  syndicationInstagramConnected?: boolean;
  instagramUsername?: string | null;
  syndicationTiktokEnabled: boolean;
  syndicationTiktokConnected?: boolean;
  tiktokUsername?: string | null;
  timezoneLastSeen: string | null;
  metadata: Record<string, unknown> | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
};

export function AdminTenantsPage() {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const { can } = useAdminAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [twitterConnected, setTwitterConnected] = useState(false);
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [optionsTenantId, setOptionsTenantId] = useState<string | null>(null);
  const [form] = Form.useForm<{
    subtitlesEnabled: boolean;
    syndicationYoutubeEnabled: boolean;
    syndicationTwitterEnabled: boolean;
    syndicationFacebookEnabled: boolean;
    syndicationInstagramEnabled: boolean;
    syndicationTiktokEnabled: boolean;
    metadataJson: string;
  }>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<{ tenants: TenantRow[] }>("/tenants");
      setRows(data.tenants || []);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const openOptions = async (tenantId: string) => {
    setOptionsTenantId(tenantId);
    setOptionsOpen(true);
    setOptionsLoading(true);
    setYoutubeConnected(false);
    setTwitterConnected(false);
    setFacebookConnected(false);
    setInstagramConnected(false);
    setTiktokConnected(false);
    form.resetFields();
    try {
      const { data } = await getAdminClient().get<TenantRow>(`/tenants/${encodeURIComponent(tenantId)}`);
      setYoutubeConnected(data.syndicationYoutubeConnected === true);
      setTwitterConnected(data.syndicationTwitterConnected === true);
      setFacebookConnected(data.syndicationFacebookConnected === true);
      setInstagramConnected(data.syndicationInstagramConnected === true);
      setTiktokConnected(data.syndicationTiktokConnected === true);
      form.setFieldsValue({
        subtitlesEnabled: data.subtitlesEnabled !== false,
        syndicationYoutubeEnabled: data.syndicationYoutubeEnabled === true,
        syndicationTwitterEnabled: data.syndicationTwitterEnabled === true,
        syndicationFacebookEnabled: data.syndicationFacebookEnabled === true,
        syndicationInstagramEnabled: data.syndicationInstagramEnabled === true,
        syndicationTiktokEnabled: data.syndicationTiktokEnabled === true,
        metadataJson:
          data.metadata && typeof data.metadata === "object"
            ? JSON.stringify(data.metadata, null, 2)
            : "",
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
      setOptionsOpen(false);
      setOptionsTenantId(null);
    } finally {
      setOptionsLoading(false);
    }
  };

  const disconnectYoutube = async () => {
    if (!optionsTenantId || !can("tenants", "edit")) return;
    setDisconnectLoading(true);
    try {
      const { data } = await getAdminClient().post<TenantRow>(
        `/tenants/${encodeURIComponent(optionsTenantId)}/youtube/disconnect`,
      );
      setYoutubeConnected(data.syndicationYoutubeConnected === true);
      message.success(t("tenants.youtubeDisconnected"));
      void load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setDisconnectLoading(false);
    }
  };

  const disconnectTwitter = async () => {
    if (!optionsTenantId || !can("tenants", "edit")) return;
    setDisconnectLoading(true);
    try {
      const { data } = await getAdminClient().post<TenantRow>(
        `/tenants/${encodeURIComponent(optionsTenantId)}/twitter/disconnect`,
      );
      setTwitterConnected(data.syndicationTwitterConnected === true);
      message.success(t("tenants.twitterDisconnected"));
      void load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setDisconnectLoading(false);
    }
  };

  const disconnectFacebook = async () => {
    if (!optionsTenantId || !can("tenants", "edit")) return;
    setDisconnectLoading(true);
    try {
      const { data } = await getAdminClient().post<TenantRow>(
        `/tenants/${encodeURIComponent(optionsTenantId)}/facebook/disconnect`,
      );
      setFacebookConnected(data.syndicationFacebookConnected === true);
      message.success(t("tenants.facebookDisconnected"));
      void load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setDisconnectLoading(false);
    }
  };

  const disconnectInstagram = async () => {
    if (!optionsTenantId || !can("tenants", "edit")) return;
    setDisconnectLoading(true);
    try {
      const { data } = await getAdminClient().post<TenantRow>(
        `/tenants/${encodeURIComponent(optionsTenantId)}/instagram/disconnect`,
      );
      setInstagramConnected(data.syndicationInstagramConnected === true);
      message.success(t("tenants.instagramDisconnected"));
      void load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setDisconnectLoading(false);
    }
  };

  const disconnectTiktok = async () => {
    if (!optionsTenantId || !can("tenants", "edit")) return;
    setDisconnectLoading(true);
    try {
      const { data } = await getAdminClient().post<TenantRow>(
        `/tenants/${encodeURIComponent(optionsTenantId)}/tiktok/disconnect`,
      );
      setTiktokConnected(data.syndicationTiktokConnected === true);
      message.success(t("tenants.tiktokDisconnected"));
      void load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setDisconnectLoading(false);
    }
  };

  const saveOptions = async () => {
    if (!optionsTenantId || !can("tenants", "edit")) return;
    let metadata: Record<string, unknown> | null = null;
    const raw = form.getFieldValue("metadataJson")?.trim() ?? "";
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          message.error(t("tenants.metadataInvalid"));
          return;
        }
        metadata = parsed as Record<string, unknown>;
      } catch {
        message.error(t("tenants.metadataInvalid"));
        return;
      }
    }
    const subtitlesEnabled = Boolean(form.getFieldValue("subtitlesEnabled"));
    const syndicationYoutubeEnabled = Boolean(form.getFieldValue("syndicationYoutubeEnabled"));
    const syndicationTwitterEnabled = Boolean(form.getFieldValue("syndicationTwitterEnabled"));
    const syndicationFacebookEnabled = Boolean(form.getFieldValue("syndicationFacebookEnabled"));
    const syndicationInstagramEnabled = Boolean(form.getFieldValue("syndicationInstagramEnabled"));
    const syndicationTiktokEnabled = Boolean(form.getFieldValue("syndicationTiktokEnabled"));
    setSaveLoading(true);
    try {
      await getAdminClient().patch(`/tenants/${encodeURIComponent(optionsTenantId)}`, {
        subtitlesEnabled,
        syndicationYoutubeEnabled,
        syndicationTwitterEnabled,
        syndicationFacebookEnabled,
        syndicationInstagramEnabled,
        syndicationTiktokEnabled,
        metadata,
      });
      message.success(t("tenants.saved"));
      setOptionsOpen(false);
      setOptionsTenantId(null);
      void load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || "Error");
    } finally {
      setSaveLoading(false);
    }
  };

  const columns: ColumnsType<TenantRow> = [
    { title: t("tenants.tenantId"), dataIndex: "tenantId", key: "tenantId", ellipsis: true },
    {
      title: t("tenants.subtitles"),
      dataIndex: "subtitlesEnabled",
      key: "subtitlesEnabled",
      width: 140,
      render: (v: boolean) => (
        <Tag color={v !== false ? "green" : "default"}>{v !== false ? t("tenants.on") : t("tenants.off")}</Tag>
      ),
    },
    {
      title: t("tenants.syndicationYoutube"),
      dataIndex: "syndicationYoutubeEnabled",
      key: "syndicationYoutubeEnabled",
      width: 120,
      render: (v: boolean) => (
        <Tag color={v === true ? "blue" : "default"}>{v === true ? t("tenants.on") : t("tenants.off")}</Tag>
      ),
    },
    {
      title: t("tenants.syndicationTwitter"),
      dataIndex: "syndicationTwitterEnabled",
      key: "syndicationTwitterEnabled",
      width: 120,
      render: (v: boolean) => (
        <Tag color={v === true ? "blue" : "default"}>{v === true ? t("tenants.on") : t("tenants.off")}</Tag>
      ),
    },
    {
      title: t("tenants.syndicationFacebook"),
      dataIndex: "syndicationFacebookEnabled",
      key: "syndicationFacebookEnabled",
      width: 120,
      render: (v: boolean) => (
        <Tag color={v === true ? "blue" : "default"}>{v === true ? t("tenants.on") : t("tenants.off")}</Tag>
      ),
    },
    {
      title: t("tenants.syndicationInstagram"),
      dataIndex: "syndicationInstagramEnabled",
      key: "syndicationInstagramEnabled",
      width: 120,
      render: (v: boolean) => (
        <Tag color={v === true ? "blue" : "default"}>{v === true ? t("tenants.on") : t("tenants.off")}</Tag>
      ),
    },
    {
      title: t("tenants.syndicationTiktok"),
      dataIndex: "syndicationTiktokEnabled",
      key: "syndicationTiktokEnabled",
      width: 120,
      render: (v: boolean) => (
        <Tag color={v === true ? "blue" : "default"}>{v === true ? t("tenants.on") : t("tenants.off")}</Tag>
      ),
    },
    { title: t("tenants.timezone"), dataIndex: "timezoneLastSeen", key: "timezoneLastSeen", ellipsis: true },
    { title: t("tenants.lastSeen"), dataIndex: "lastSeenAt", key: "lastSeenAt", width: 200 },
    {
      title: t("tenants.actions"),
      key: "actions",
      width: 100,
      render: (_, record) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "options",
                label: t("tenants.options"),
                onClick: () => void openOptions(record.tenantId),
              },
            ],
          }}
        >
          <Button type="text" icon={<MoreOutlined style={{ transform: "rotate(90deg)" }} />} aria-label="actions" />
        </Dropdown>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t("tenants.title")}
      </Typography.Title>
      <Table<TenantRow>
        rowKey="tenantId"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
      />
      <Modal
        title={t("tenants.optionsTitle", { id: optionsTenantId || "" })}
        open={optionsOpen}
        onCancel={() => {
          setOptionsOpen(false);
          setOptionsTenantId(null);
        }}
        footer={
          can("tenants", "edit")
            ? [
                <Button key="cancel" onClick={() => setOptionsOpen(false)} disabled={saveLoading}>
                  {t("common.cancel")}
                </Button>,
                <Button key="save" type="primary" loading={saveLoading} onClick={() => void saveOptions()}>
                  {t("common.save")}
                </Button>,
              ]
            : [
                <Button key="close" onClick={() => setOptionsOpen(false)}>
                  {t("tenants.close")}
                </Button>,
              ]
        }
        destroyOnClose
      >
        <Spin spinning={optionsLoading}>
          <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item name="subtitlesEnabled" label={t("tenants.subtitlesEnabledLabel")} valuePropName="checked">
              <Switch disabled={!can("tenants", "edit")} />
            </Form.Item>
            <Form.Item
              name="syndicationYoutubeEnabled"
              label={t("tenants.syndicationYoutubeEnabledLabel")}
              valuePropName="checked"
            >
              <Switch disabled={!can("tenants", "edit")} />
            </Form.Item>
            <Form.Item label={t("tenants.youtubeConnectionLabel")} extra={t("tenants.youtubeConnectionHint")}>
              <Space wrap>
                <Tag color={youtubeConnected ? "green" : "default"}>
                  {youtubeConnected ? t("tenants.youtubeConnected") : t("tenants.youtubeNotConnected")}
                </Tag>
                {can("tenants", "edit") && youtubeConnected ? (
                  <Popconfirm
                    title={t("tenants.youtubeDisconnectConfirmTitle")}
                    description={t("tenants.youtubeDisconnectConfirmDescription")}
                    okText={t("tenants.youtubeDisconnect")}
                    okButtonProps={{ danger: true }}
                    cancelText={t("common.cancel")}
                    onConfirm={() => void disconnectYoutube()}
                  >
                    <Button danger loading={disconnectLoading}>
                      {t("tenants.youtubeDisconnect")}
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            </Form.Item>
            <Form.Item
              name="syndicationTwitterEnabled"
              label={t("tenants.syndicationTwitterEnabledLabel")}
              valuePropName="checked"
            >
              <Switch disabled={!can("tenants", "edit")} />
            </Form.Item>
            <Form.Item label={t("tenants.twitterConnectionLabel")} extra={t("tenants.twitterConnectionHint")}>
              <Space wrap>
                <Tag color={twitterConnected ? "green" : "default"}>
                  {twitterConnected ? t("tenants.twitterConnected") : t("tenants.twitterNotConnected")}
                </Tag>
                {can("tenants", "edit") && twitterConnected ? (
                  <Popconfirm
                    title={t("tenants.twitterDisconnectConfirmTitle")}
                    description={t("tenants.twitterDisconnectConfirmDescription")}
                    okText={t("tenants.twitterDisconnect")}
                    okButtonProps={{ danger: true }}
                    cancelText={t("common.cancel")}
                    onConfirm={() => void disconnectTwitter()}
                  >
                    <Button danger loading={disconnectLoading}>
                      {t("tenants.twitterDisconnect")}
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            </Form.Item>
            <Form.Item
              name="syndicationFacebookEnabled"
              label={t("tenants.syndicationFacebookEnabledLabel")}
              valuePropName="checked"
            >
              <Switch disabled={!can("tenants", "edit")} />
            </Form.Item>
            <Form.Item label={t("tenants.facebookConnectionLabel")} extra={t("tenants.facebookConnectionHint")}>
              <Space wrap>
                <Tag color={facebookConnected ? "green" : "default"}>
                  {facebookConnected ? t("tenants.facebookConnected") : t("tenants.facebookNotConnected")}
                </Tag>
                {can("tenants", "edit") && facebookConnected ? (
                  <Popconfirm
                    title={t("tenants.facebookDisconnectConfirmTitle")}
                    description={t("tenants.facebookDisconnectConfirmDescription")}
                    okText={t("tenants.facebookDisconnect")}
                    okButtonProps={{ danger: true }}
                    cancelText={t("common.cancel")}
                    onConfirm={() => void disconnectFacebook()}
                  >
                    <Button danger loading={disconnectLoading}>
                      {t("tenants.facebookDisconnect")}
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            </Form.Item>
            <Form.Item
              name="syndicationInstagramEnabled"
              label={t("tenants.syndicationInstagramEnabledLabel")}
              valuePropName="checked"
            >
              <Switch disabled={!can("tenants", "edit")} />
            </Form.Item>
            <Form.Item label={t("tenants.instagramConnectionLabel")} extra={t("tenants.instagramConnectionHint")}>
              <Space wrap>
                <Tag color={instagramConnected ? "green" : "default"}>
                  {instagramConnected ? t("tenants.instagramConnected") : t("tenants.instagramNotConnected")}
                </Tag>
                {can("tenants", "edit") && instagramConnected ? (
                  <Popconfirm
                    title={t("tenants.instagramDisconnectConfirmTitle")}
                    description={t("tenants.instagramDisconnectConfirmDescription")}
                    okText={t("tenants.instagramDisconnect")}
                    okButtonProps={{ danger: true }}
                    cancelText={t("common.cancel")}
                    onConfirm={() => void disconnectInstagram()}
                  >
                    <Button danger loading={disconnectLoading}>
                      {t("tenants.instagramDisconnect")}
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            </Form.Item>
            <Form.Item
              name="syndicationTiktokEnabled"
              label={t("tenants.syndicationTiktokEnabledLabel")}
              valuePropName="checked"
            >
              <Switch disabled={!can("tenants", "edit")} />
            </Form.Item>
            <Form.Item label={t("tenants.tiktokConnectionLabel")} extra={t("tenants.tiktokConnectionHint")}>
              <Space wrap>
                <Tag color={tiktokConnected ? "green" : "default"}>
                  {tiktokConnected ? t("tenants.tiktokConnected") : t("tenants.tiktokNotConnected")}
                </Tag>
                {can("tenants", "edit") && tiktokConnected ? (
                  <Popconfirm
                    title={t("tenants.tiktokDisconnectConfirmTitle")}
                    description={t("tenants.tiktokDisconnectConfirmDescription")}
                    okText={t("tenants.tiktokDisconnect")}
                    okButtonProps={{ danger: true }}
                    cancelText={t("common.cancel")}
                    onConfirm={() => void disconnectTiktok()}
                  >
                    <Button danger loading={disconnectLoading}>
                      {t("tenants.tiktokDisconnect")}
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            </Form.Item>
            <Form.Item
              name="metadataJson"
              label={t("tenants.metadataJson")}
              extra={t("tenants.metadataHint")}
            >
              <Input.TextArea rows={8} disabled={!can("tenants", "edit")} />
            </Form.Item>
          </Form>
        </Spin>
      </Modal>
    </div>
  );
}
