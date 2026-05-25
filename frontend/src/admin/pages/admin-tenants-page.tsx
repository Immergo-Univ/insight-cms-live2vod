import { useCallback, useEffect, useState } from "react";
import { App, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { getAdminClient } from "@/admin/admin-api";

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
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TenantRow[]>([]);

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

  const columns: ColumnsType<TenantRow> = [
    {
      title: t("tenants.tenantId"),
      dataIndex: "tenantId",
      key: "tenantId",
      ellipsis: true,
      render: (tenantId: string) => <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tenantId}</span>,
    },
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
  ];

  return (
    <div style={{ width: "100%" }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t("tenants.title")}
      </Typography.Title>
      <Table<TenantRow>
        className="admin-tenants-table"
        style={{ width: "100%" }}
        rowKey="tenantId"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        rowClassName="admin-clickable-row"
        onRow={(record) => ({
          onClick: () => navigate(`/admin/tenants/${encodeURIComponent(record.tenantId)}`),
        })}
      />
    </div>
  );
}
