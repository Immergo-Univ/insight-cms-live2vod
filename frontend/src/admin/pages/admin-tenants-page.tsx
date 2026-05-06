import { useCallback, useEffect, useState } from "react";
import { App, Button, Dropdown, Form, Input, Modal, Spin, Switch, Table, Tag, Typography } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth-context";

type TenantRow = {
  tenantId: string;
  subtitlesEnabled: boolean;
  syndicationYoutubeEnabled: boolean;
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
  const [optionsTenantId, setOptionsTenantId] = useState<string | null>(null);
  const [form] = Form.useForm<{
    subtitlesEnabled: boolean;
    syndicationYoutubeEnabled: boolean;
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
    form.resetFields();
    try {
      const { data } = await getAdminClient().get<TenantRow>(`/tenants/${encodeURIComponent(tenantId)}`);
      form.setFieldsValue({
        subtitlesEnabled: data.subtitlesEnabled !== false,
        syndicationYoutubeEnabled: data.syndicationYoutubeEnabled === true,
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
    setSaveLoading(true);
    try {
      await getAdminClient().patch(`/tenants/${encodeURIComponent(optionsTenantId)}`, {
        subtitlesEnabled,
        syndicationYoutubeEnabled,
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
