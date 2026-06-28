import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Col, Form, Input, InputNumber, Popconfirm, Row, Space, Spin, Statistic, Switch, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getAdminClient } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth-context";
import {
  fetchTenantSyndicationFacebookPages,
  postTenantSyndicationFacebookSelectPage,
} from "@/services/tenant-syndication.service";

type TenantDetail = {
  tenantId: string;
  subtitlesEnabled: boolean;
  subtitlesDefaultEnabled?: boolean;
  subtitlesTranscriptNewsUiEnabled?: boolean;
  subtitlesDefaultBurnIn?: boolean;
  subtitlesDefaultDiarization?: boolean;
  subtitlesDefaultInferSpeakerNames?: boolean;
  subtitlesDefaultNewsEn?: boolean;
  subtitlesDefaultNewsEs?: boolean;
  subtitlesDefaultNewsHe?: boolean;
  syndicationYoutubeEnabled: boolean;
  syndicationYoutubeDefaultEnabled?: boolean;
  syndicationYoutubeConnected?: boolean;
  syndicationTwitterEnabled: boolean;
  syndicationTwitterDefaultEnabled?: boolean;
  syndicationTwitterConnected?: boolean;
  syndicationFacebookEnabled: boolean;
  syndicationFacebookDefaultEnabled?: boolean;
  syndicationFacebookConnected?: boolean;
  facebookPageId?: string | null;
  facebookPageName?: string | null;
  syndicationInstagramEnabled: boolean;
  syndicationInstagramDefaultEnabled?: boolean;
  syndicationInstagramConnected?: boolean;
  instagramBusinessAccountId?: string | null;
  instagramUsername?: string | null;
  syndicationTiktokEnabled: boolean;
  syndicationTiktokDefaultEnabled?: boolean;
  syndicationTiktokConnected?: boolean;
  tiktokUsername?: string | null;
  syndicationAccountMaxByPlatform?: Partial<SyndicationAccountMaxByPlatform> | null;
  metadata: Record<string, unknown> | null;
};

type FormShape = {
  subtitlesEnabled: boolean;
  subtitlesDefaultEnabled: boolean;
  subtitlesTranscriptNewsUiEnabled: boolean;
  subtitlesDefaultBurnIn: boolean;
  subtitlesDefaultDiarization: boolean;
  subtitlesDefaultInferSpeakerNames: boolean;
  subtitlesDefaultNewsEn: boolean;
  subtitlesDefaultNewsEs: boolean;
  subtitlesDefaultNewsHe: boolean;
  syndicationYoutubeEnabled: boolean;
  syndicationYoutubeDefaultEnabled: boolean;
  syndicationTwitterEnabled: boolean;
  syndicationTwitterDefaultEnabled: boolean;
  syndicationFacebookEnabled: boolean;
  syndicationFacebookDefaultEnabled: boolean;
  syndicationInstagramEnabled: boolean;
  syndicationInstagramDefaultEnabled: boolean;
  syndicationTiktokEnabled: boolean;
  syndicationTiktokDefaultEnabled: boolean;
  syndicationAccountMaxByPlatform: SyndicationAccountMaxByPlatform;
  metadataJson: string;
};

type FacebookPageOption = { id: string; name: string };
type NetworkName = "youtube" | "twitter" | "facebook" | "instagram" | "tiktok";
type SyndicationAccountMaxByPlatform = Record<NetworkName, number>;

const DEFAULT_SYNDICATION_ACCOUNT_MAX = 5;

function defaultSyndicationAccountMaxByPlatform(
  raw?: Partial<SyndicationAccountMaxByPlatform> | null,
): SyndicationAccountMaxByPlatform {
  const read = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_SYNDICATION_ACCOUNT_MAX;
  };
  return {
    youtube: read(raw?.youtube),
    twitter: read(raw?.twitter),
    facebook: read(raw?.facebook),
    instagram: read(raw?.instagram),
    tiktok: read(raw?.tiktok),
  };
}

type SyndicationAccountRow = {
  id: string;
  platform: NetworkName | string;
  displayName: string;
  status: string;
  externalAccountId: string;
};

type TenantDashboard = {
  monthlyClips: { current: number; previous: number; trendPercent: number };
  syndicationVideosByNetwork: Record<NetworkName, number>;
  apiCostByNetwork: Record<NetworkName, { videos: number; unitCostUsd: number; estimatedCostUsd: number }>;
  aiTokenUsage: { totalTokens: number; estimatedCostUsd: number };
  encodeUsage: {
    minutesCurrent: number;
    minutesPrevious: number;
    trendPercent: number;
    costPerMinuteUsd: number;
    estimatedCostUsd: number;
  };
  dailyEncodeCounts: Array<{ date: string; count: number }>;
  generatedAt: string;
};

function readErrorMessage(e: unknown, fallback = "Error"): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err.response?.data?.error || err.message || fallback;
}

export function AdminTenantSettingsPage() {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const { can } = useAdminAuth();
  const navigate = useNavigate();
  const { tenantId: tenantIdParam } = useParams();
  const tenantId = String(tenantIdParam || "").trim();

  const [form] = Form.useForm<FormShape>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState<string | null>(null);
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [facebookPages, setFacebookPages] = useState<FacebookPageOption[]>([]);
  const [facebookPagesLoading, setFacebookPagesLoading] = useState(false);
  const [facebookPageSaving, setFacebookPageSaving] = useState(false);
  const [selectedFacebookPageId, setSelectedFacebookPageId] = useState<string>("");
  const [dashboard, setDashboard] = useState<TenantDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [syndicationAccounts, setSyndicationAccounts] = useState<SyndicationAccountRow[]>([]);
  const [syndicationAccountsLoading, setSyndicationAccountsLoading] = useState(false);

  const setFormFromDetail = useCallback(
    (data: TenantDetail) => {
      form.setFieldsValue({
        subtitlesEnabled: data.subtitlesEnabled !== false,
        subtitlesDefaultEnabled: data.subtitlesDefaultEnabled === true,
        subtitlesTranscriptNewsUiEnabled: data.subtitlesTranscriptNewsUiEnabled !== false,
        subtitlesDefaultBurnIn: data.subtitlesDefaultBurnIn === true,
        subtitlesDefaultDiarization: data.subtitlesDefaultDiarization !== false,
        subtitlesDefaultInferSpeakerNames: data.subtitlesDefaultInferSpeakerNames === true,
        subtitlesDefaultNewsEn: data.subtitlesDefaultNewsEn !== false,
        subtitlesDefaultNewsEs: data.subtitlesDefaultNewsEs !== false,
        subtitlesDefaultNewsHe: data.subtitlesDefaultNewsHe !== false,
        syndicationYoutubeEnabled: data.syndicationYoutubeEnabled === true,
        syndicationYoutubeDefaultEnabled: data.syndicationYoutubeDefaultEnabled === true,
        syndicationTwitterEnabled: data.syndicationTwitterEnabled === true,
        syndicationTwitterDefaultEnabled: data.syndicationTwitterDefaultEnabled === true,
        syndicationFacebookEnabled: data.syndicationFacebookEnabled === true,
        syndicationFacebookDefaultEnabled: data.syndicationFacebookDefaultEnabled === true,
        syndicationInstagramEnabled: data.syndicationInstagramEnabled === true,
        syndicationInstagramDefaultEnabled: data.syndicationInstagramDefaultEnabled === true,
        syndicationTiktokEnabled: data.syndicationTiktokEnabled === true,
        syndicationTiktokDefaultEnabled: data.syndicationTiktokDefaultEnabled === true,
        syndicationAccountMaxByPlatform: defaultSyndicationAccountMaxByPlatform(data.syndicationAccountMaxByPlatform),
        metadataJson: data.metadata && typeof data.metadata === "object" ? JSON.stringify(data.metadata, null, 2) : "",
      });
      setSelectedFacebookPageId(typeof data.facebookPageId === "string" ? data.facebookPageId : "");
    },
    [form],
  );

  const loadTenant = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<TenantDetail>(`/tenants/${encodeURIComponent(tenantId)}`);
      setDetail(data);
      setFormFromDetail(data);
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [message, setFormFromDetail, tenantId]);

  const loadSyndicationAccounts = useCallback(async () => {
    if (!tenantId) return;
    setSyndicationAccountsLoading(true);
    try {
      const { data } = await getAdminClient().get<SyndicationAccountRow[]>(
        `/tenants/${encodeURIComponent(tenantId)}/syndication/accounts`,
      );
      setSyndicationAccounts(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
      setSyndicationAccounts([]);
    } finally {
      setSyndicationAccountsLoading(false);
    }
  }, [message, tenantId]);

  useEffect(() => {
    void loadTenant();
    void loadSyndicationAccounts();
  }, [loadTenant, loadSyndicationAccounts]);

  const loadDashboard = useCallback(async () => {
    if (!tenantId) return;
    setDashboardLoading(true);
    try {
      const { data } = await getAdminClient().get<TenantDashboard>(`/tenants/${encodeURIComponent(tenantId)}/dashboard`);
      setDashboard(data);
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setDashboardLoading(false);
    }
  }, [message, tenantId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const loadFacebookPages = useCallback(async () => {
    if (!tenantId) return;
    setFacebookPagesLoading(true);
    try {
      const pages = await fetchTenantSyndicationFacebookPages(tenantId);
      setFacebookPages(pages);
      if (!selectedFacebookPageId && pages.length === 1) {
        setSelectedFacebookPageId(pages[0].id);
      }
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setFacebookPagesLoading(false);
    }
  }, [message, selectedFacebookPageId, tenantId]);

  useEffect(() => {
    if (detail?.syndicationFacebookConnected === true) {
      void loadFacebookPages();
    }
  }, [detail?.syndicationFacebookConnected, loadFacebookPages]);

  const saveOptions = async () => {
    if (!tenantId || !can("tenants", "edit")) return;

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

    const payload = {
      subtitlesEnabled: Boolean(form.getFieldValue("subtitlesEnabled")),
      subtitlesDefaultEnabled: Boolean(form.getFieldValue("subtitlesDefaultEnabled")),
      subtitlesTranscriptNewsUiEnabled: Boolean(form.getFieldValue("subtitlesTranscriptNewsUiEnabled")),
      subtitlesDefaultBurnIn: Boolean(form.getFieldValue("subtitlesDefaultBurnIn")),
      subtitlesDefaultDiarization: Boolean(form.getFieldValue("subtitlesDefaultDiarization")),
      subtitlesDefaultInferSpeakerNames: Boolean(form.getFieldValue("subtitlesDefaultInferSpeakerNames")),
      subtitlesDefaultNewsEn: Boolean(form.getFieldValue("subtitlesDefaultNewsEn")),
      subtitlesDefaultNewsEs: Boolean(form.getFieldValue("subtitlesDefaultNewsEs")),
      subtitlesDefaultNewsHe: Boolean(form.getFieldValue("subtitlesDefaultNewsHe")),
      syndicationYoutubeEnabled: Boolean(form.getFieldValue("syndicationYoutubeEnabled")),
      syndicationYoutubeDefaultEnabled: Boolean(form.getFieldValue("syndicationYoutubeDefaultEnabled")),
      syndicationTwitterEnabled: Boolean(form.getFieldValue("syndicationTwitterEnabled")),
      syndicationTwitterDefaultEnabled: Boolean(form.getFieldValue("syndicationTwitterDefaultEnabled")),
      syndicationFacebookEnabled: Boolean(form.getFieldValue("syndicationFacebookEnabled")),
      syndicationFacebookDefaultEnabled: Boolean(form.getFieldValue("syndicationFacebookDefaultEnabled")),
      syndicationInstagramEnabled: Boolean(form.getFieldValue("syndicationInstagramEnabled")),
      syndicationInstagramDefaultEnabled: Boolean(form.getFieldValue("syndicationInstagramDefaultEnabled")),
      syndicationTiktokEnabled: Boolean(form.getFieldValue("syndicationTiktokEnabled")),
      syndicationTiktokDefaultEnabled: Boolean(form.getFieldValue("syndicationTiktokDefaultEnabled")),
      syndicationAccountMaxByPlatform: defaultSyndicationAccountMaxByPlatform(
        form.getFieldValue("syndicationAccountMaxByPlatform"),
      ),
      metadata,
    };

    setSaving(true);
    try {
      await getAdminClient().patch(`/tenants/${encodeURIComponent(tenantId)}`, payload);
      message.success(t("tenants.saved"));
      await Promise.all([loadTenant(), loadDashboard(), loadSyndicationAccounts()]);
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const disconnectNetwork = async (network: "youtube" | "twitter" | "facebook" | "instagram" | "tiktok") => {
    if (!tenantId || !can("tenants", "edit")) return;
    setDisconnectLoading(network);
    try {
      await getAdminClient().post(`/tenants/${encodeURIComponent(tenantId)}/${network}/disconnect`);
      message.success(t(`tenants.${network}Disconnected`));
      await Promise.all([loadTenant(), loadDashboard(), loadSyndicationAccounts()]);
      if (network === "facebook") {
        setFacebookPages([]);
        setSelectedFacebookPageId("");
      }
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setDisconnectLoading(null);
    }
  };

  const disconnectSyndicationAccount = async (accountId: string) => {
    if (!tenantId || !can("tenants", "edit")) return;
    setDisconnectLoading(accountId);
    try {
      await getAdminClient().delete(
        `/tenants/${encodeURIComponent(tenantId)}/syndication/accounts/${encodeURIComponent(accountId)}`,
      );
      message.success(t("tenants.syndicationAccountDisconnected"));
      await Promise.all([loadTenant(), loadDashboard(), loadSyndicationAccounts()]);
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setDisconnectLoading(null);
    }
  };

  const saveFacebookPage = async () => {
    if (!tenantId || !can("tenants", "edit")) return;
    const pageId = selectedFacebookPageId.trim();
    if (!pageId) {
      message.error(t("tenants.facebookPageRequired"));
      return;
    }
    setFacebookPageSaving(true);
    try {
      const status = await postTenantSyndicationFacebookSelectPage(tenantId, pageId);
      setSelectedFacebookPageId(status.facebook.pageId || pageId);
      message.success(t("tenants.facebookPageSaved"));
      await Promise.all([loadTenant(), loadDashboard()]);
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setFacebookPageSaving(false);
    }
  };

  const facebookPagesColumns: ColumnsType<FacebookPageOption> = [
    {
      title: t("tenants.facebookPagesTableName"),
      dataIndex: "name",
      key: "name",
      ellipsis: true,
    },
    {
      title: t("tenants.facebookPagesTableId"),
      dataIndex: "id",
      key: "id",
      width: 300,
      ellipsis: true,
    },
    {
      title: t("tenants.facebookPagesTableStatus"),
      key: "status",
      width: 160,
      render: (_, row) => (
        <Tag color={row.id === selectedFacebookPageId ? "green" : "default"}>
          {row.id === selectedFacebookPageId ? t("tenants.facebookPagesTableSelected") : t("tenants.facebookPagesTableSelect")}
        </Tag>
      ),
    },
  ];

  const networkLabels: Record<NetworkName, string> = {
    youtube: "YouTube",
    twitter: "X",
    facebook: "Facebook",
    instagram: "Instagram",
    tiktok: "TikTok",
  };

  const apiCostRows = useMemo(() => {
    if (!dashboard) return [];
    return (Object.keys(networkLabels) as NetworkName[]).map((network) => ({
      key: network,
      network: networkLabels[network],
      videos: dashboard.syndicationVideosByNetwork?.[network] || 0,
      unitCostUsd: dashboard.apiCostByNetwork?.[network]?.unitCostUsd || 0,
      estimatedCostUsd: dashboard.apiCostByNetwork?.[network]?.estimatedCostUsd || 0,
    }));
  }, [dashboard]);

  const maxDailyCount = useMemo(() => {
    if (!dashboard?.dailyEncodeCounts?.length) return 0;
    return Math.max(...dashboard.dailyEncodeCounts.map((d) => Number(d.count) || 0), 0);
  }, [dashboard]);

  const dailyEncodeChartData = useMemo(() => {
    if (!dashboard?.dailyEncodeCounts?.length) return [];
    return dashboard.dailyEncodeCounts.map((d) => ({
      ...d,
      dayLabel: d.date.slice(5),
    }));
  }, [dashboard]);

  const formatUsd = (value: number) => `$${Number(value || 0).toFixed(4)}`;
  const formatTrend = (value: number) => `${value >= 0 ? "+" : ""}${Number(value || 0).toFixed(2)}%`;

  const syndicationSwitches: Array<{
    name:
      | "syndicationYoutubeEnabled"
      | "syndicationYoutubeDefaultEnabled"
      | "syndicationTwitterEnabled"
      | "syndicationTwitterDefaultEnabled"
      | "syndicationFacebookEnabled"
      | "syndicationFacebookDefaultEnabled"
      | "syndicationInstagramEnabled"
      | "syndicationInstagramDefaultEnabled"
      | "syndicationTiktokEnabled"
      | "syndicationTiktokDefaultEnabled";
    label: string;
  }> = [
    { name: "syndicationYoutubeEnabled", label: t("tenants.syndicationYoutubeEnabledLabel") },
    { name: "syndicationYoutubeDefaultEnabled", label: t("tenants.syndicationYoutubeDefaultEnabledLabel") },
    { name: "syndicationTwitterEnabled", label: t("tenants.syndicationTwitterEnabledLabel") },
    { name: "syndicationTwitterDefaultEnabled", label: t("tenants.syndicationTwitterDefaultEnabledLabel") },
    { name: "syndicationFacebookEnabled", label: t("tenants.syndicationFacebookEnabledLabel") },
    { name: "syndicationFacebookDefaultEnabled", label: t("tenants.syndicationFacebookDefaultEnabledLabel") },
    { name: "syndicationInstagramEnabled", label: t("tenants.syndicationInstagramEnabledLabel") },
    { name: "syndicationInstagramDefaultEnabled", label: t("tenants.syndicationInstagramDefaultEnabledLabel") },
    { name: "syndicationTiktokEnabled", label: t("tenants.syndicationTiktokEnabledLabel") },
    { name: "syndicationTiktokDefaultEnabled", label: t("tenants.syndicationTiktokDefaultEnabledLabel") },
  ];

  const subtitleSwitches: Array<{
    name:
      | "subtitlesEnabled"
      | "subtitlesDefaultEnabled"
      | "subtitlesTranscriptNewsUiEnabled"
      | "subtitlesDefaultBurnIn"
      | "subtitlesDefaultDiarization"
      | "subtitlesDefaultInferSpeakerNames"
      | "subtitlesDefaultNewsEn"
      | "subtitlesDefaultNewsEs"
      | "subtitlesDefaultNewsHe";
    label: string;
    hint?: string;
  }> = [
    { name: "subtitlesEnabled", label: t("tenants.subtitlesEnabledLabel") },
    { name: "subtitlesDefaultEnabled", label: t("tenants.subtitlesDefaultEnabledLabel") },
    {
      name: "subtitlesTranscriptNewsUiEnabled",
      label: t("tenants.subtitlesTranscriptNewsUiEnabledLabel"),
      hint: t("tenants.subtitlesTranscriptNewsUiEnabledHint"),
    },
    { name: "subtitlesDefaultBurnIn", label: t("tenants.subtitlesDefaultBurnInLabel") },
    { name: "subtitlesDefaultDiarization", label: t("tenants.subtitlesDefaultDiarizationLabel") },
    { name: "subtitlesDefaultInferSpeakerNames", label: t("tenants.subtitlesDefaultInferSpeakerNamesLabel") },
    { name: "subtitlesDefaultNewsEn", label: t("tenants.subtitlesDefaultNewsEnLabel") },
    { name: "subtitlesDefaultNewsEs", label: t("tenants.subtitlesDefaultNewsEsLabel") },
    { name: "subtitlesDefaultNewsHe", label: t("tenants.subtitlesDefaultNewsHeLabel") },
  ];

  const renderSwitchList = (
    items: Array<{ name: keyof FormShape; label: string; hint?: string }>,
  ) => (
    <div style={{ maxWidth: 900 }}>
      {items.map((item) => (
        <Form.Item key={String(item.name)} style={{ marginBottom: 14 }}>
          <Space align="start" size={10}>
            <Form.Item name={item.name} valuePropName="checked" noStyle>
              <Switch disabled={!can("tenants", "edit")} />
            </Form.Item>
            <div>
              <Typography.Text>{item.label}</Typography.Text>
              {item.hint ? (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
                  {item.hint}
                </Typography.Paragraph>
              ) : null}
            </div>
          </Space>
        </Form.Item>
      ))}
    </div>
  );

  const renderNetworkSyndicationSection = useCallback(
    (network: NetworkName) => {
      const networkAccounts = syndicationAccounts.filter((account) => account.platform === network);
      const maxAccounts =
        form.getFieldValue(["syndicationAccountMaxByPlatform", network]) ??
        detail?.syndicationAccountMaxByPlatform?.[network] ??
        DEFAULT_SYNDICATION_ACCOUNT_MAX;

      return (
        <>
          <Form.Item
            label={t("tenants.networkAccountsLabel")}
            extra={t("tenants.networkAccountsHint", {
              count: networkAccounts.length,
              max: maxAccounts,
            })}
          >
            {syndicationAccountsLoading ? (
              <Typography.Text type="secondary">{t("common.loading")}</Typography.Text>
            ) : networkAccounts.length === 0 ? (
              <Typography.Text type="secondary">{t("tenants.syndicationAccountsEmpty")}</Typography.Text>
            ) : (
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space wrap size={[8, 8]}>
                  {networkAccounts.map((account) => (
                    <Tag
                      key={account.id}
                      color={account.status === "active" ? "green" : account.status === "pending_selection" ? "gold" : "default"}
                    >
                      {account.displayName}
                    </Tag>
                  ))}
                </Space>
                {can("tenants", "edit") ? (
                  <Space wrap>
                    {networkAccounts.map((account) => (
                      <Popconfirm
                        key={`disconnect-${account.id}`}
                        title={t("tenants.syndicationAccountDisconnectConfirmTitle")}
                        description={t("tenants.syndicationAccountDisconnectConfirmDescription", {
                          name: account.displayName,
                          platform: account.platform,
                        })}
                        okText={t("tenants.syndicationAccountDisconnect")}
                        okButtonProps={{ danger: true }}
                        cancelText={t("common.cancel")}
                        onConfirm={() => void disconnectSyndicationAccount(account.id)}
                      >
                        <Button danger size="small" loading={disconnectLoading === account.id}>
                          {t("tenants.syndicationAccountDisconnectNamed", { name: account.displayName })}
                        </Button>
                      </Popconfirm>
                    ))}
                  </Space>
                ) : null}
              </Space>
            )}
          </Form.Item>
          <Form.Item
            label={t("tenants.syndicationMaxAccountsLabel")}
            name={["syndicationAccountMaxByPlatform", network]}
            extra={t("tenants.syndicationMaxAccountsHint", { defaultMax: DEFAULT_SYNDICATION_ACCOUNT_MAX })}
          >
            <InputNumber min={1} max={50} disabled={!can("tenants", "edit")} style={{ width: 140 }} />
          </Form.Item>
        </>
      );
    },
    [can, detail?.syndicationAccountMaxByPlatform, disconnectLoading, disconnectSyndicationAccount, form, syndicationAccounts, syndicationAccountsLoading, t],
  );

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("tenants.settingsPageTitle", { id: tenantId })}
        </Typography.Title>
        <Space>
          <Button onClick={() => navigate("/admin/tenants")}>{t("tenants.backToList")}</Button>
          {can("tenants", "edit") ? (
            <Button type="primary" loading={saving} onClick={() => void saveOptions()}>
              {t("common.save")}
            </Button>
          ) : null}
        </Space>
      </Space>

      <Spin spinning={loading}>
        <Form form={form} layout="vertical">
          <Tabs
            defaultActiveKey="dashboard"
            items={[
              {
                key: "dashboard",
                label: "Dashboard",
                children: (
                  <Spin spinning={dashboardLoading}>
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={12} xl={8}>
                          <Card>
                            <Statistic title="Monthly clips" value={dashboard?.monthlyClips?.current || 0} />
                            <Typography.Text type="secondary">
                              Trend vs previous month: {formatTrend(dashboard?.monthlyClips?.trendPercent || 0)}
                            </Typography.Text>
                          </Card>
                        </Col>
                        <Col xs={24} md={12} xl={8}>
                          <Card>
                            <Statistic title="AI token usage (month)" value={dashboard?.aiTokenUsage?.totalTokens || 0} />
                            <Typography.Text type="secondary">
                              Estimated cost: {formatUsd(dashboard?.aiTokenUsage?.estimatedCostUsd || 0)}
                            </Typography.Text>
                          </Card>
                        </Col>
                        <Col xs={24} md={12} xl={8}>
                          <Card>
                            <Statistic
                              title="Encoded minutes (month)"
                              value={dashboard?.encodeUsage?.minutesCurrent || 0}
                              precision={2}
                            />
                            <Typography.Text type="secondary">
                              Trend vs previous month: {formatTrend(dashboard?.encodeUsage?.trendPercent || 0)}
                            </Typography.Text>
                            <br />
                            <Typography.Text type="secondary">
                              Estimated encode cost: {formatUsd(dashboard?.encodeUsage?.estimatedCostUsd || 0)}
                            </Typography.Text>
                          </Card>
                        </Col>
                      </Row>

                      <Card title="Syndicated videos by social network (month)">
                        <Table
                          size="small"
                          pagination={false}
                          dataSource={apiCostRows}
                          columns={[
                            { title: "Network", dataIndex: "network", key: "network" },
                            { title: "Videos", dataIndex: "videos", key: "videos", width: 120 },
                          ]}
                        />
                      </Card>

                      <Card title="API usage cost by social network (month)">
                        <Table
                          size="small"
                          pagination={false}
                          dataSource={apiCostRows}
                          columns={[
                            { title: "Network", dataIndex: "network", key: "network" },
                            { title: "Videos", dataIndex: "videos", key: "videos", width: 110 },
                            {
                              title: "Unit cost (USD/video)",
                              dataIndex: "unitCostUsd",
                              key: "unitCostUsd",
                              width: 180,
                              render: (v: number) => formatUsd(v),
                            },
                            {
                              title: "Estimated cost (USD)",
                              dataIndex: "estimatedCostUsd",
                              key: "estimatedCostUsd",
                              width: 180,
                              render: (v: number) => formatUsd(v),
                            },
                          ]}
                        />
                      </Card>

                      <Card title="Daily encodes (last 30 days)">
                        {dailyEncodeChartData.length === 0 ? (
                          <Typography.Text type="secondary">No data.</Typography.Text>
                        ) : (
                          <div style={{ width: "100%", height: Math.max(380, dailyEncodeChartData.length * 18) }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={dailyEncodeChartData}
                                layout="vertical"
                                margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                  type="number"
                                  allowDecimals={false}
                                  domain={[0, Math.max(1, maxDailyCount)]}
                                />
                                <YAxis
                                  type="category"
                                  dataKey="dayLabel"
                                  width={52}
                                  tick={{ fontSize: 11 }}
                                />
                                <Tooltip
                                  formatter={(value: unknown) => [Number(value || 0), "Encodes"]}
                                  labelFormatter={(label: unknown) => `Date: ${String(label || "")}`}
                                />
                                <Bar dataKey="count" fill="#3d9f6f" radius={[0, 4, 4, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </Card>
                    </Space>
                  </Spin>
                ),
              },
              {
                key: "subtitles",
                label: t("tenants.tabSubtitles"),
                children: renderSwitchList(subtitleSwitches),
              },
              {
                key: "syndication",
                label: t("tenants.tabSyndication"),
                children: renderSwitchList(syndicationSwitches),
              },
              {
                key: "youtube",
                label: "YouTube",
                children: (
                  <div style={{ maxWidth: 900 }}>
                    <Form.Item label={t("tenants.youtubeConnectionLabel")} extra={t("tenants.youtubeConnectionHint")}>
                      <Space wrap>
                        <Tag className="admin-connection-pill" color={detail?.syndicationYoutubeConnected ? "green" : "default"}>
                          {detail?.syndicationYoutubeConnected ? t("tenants.youtubeConnected") : t("tenants.youtubeNotConnected")}
                        </Tag>
                        {can("tenants", "edit") && detail?.syndicationYoutubeConnected ? (
                          <Popconfirm
                            title={t("tenants.youtubeDisconnectConfirmTitle")}
                            description={t("tenants.youtubeDisconnectConfirmDescription")}
                            okText={t("tenants.youtubeDisconnect")}
                            okButtonProps={{ danger: true }}
                            cancelText={t("common.cancel")}
                            onConfirm={() => void disconnectNetwork("youtube")}
                          >
                            <Button className="admin-connection-pill" danger loading={disconnectLoading === "youtube"}>
                              {t("tenants.youtubeDisconnect")}
                            </Button>
                          </Popconfirm>
                        ) : null}
                      </Space>
                    </Form.Item>
                    {renderNetworkSyndicationSection("youtube")}
                  </div>
                ),
              },
              {
                key: "twitter",
                label: "X",
                children: (
                  <div style={{ maxWidth: 900 }}>
                    <Form.Item label={t("tenants.twitterConnectionLabel")} extra={t("tenants.twitterConnectionHint")}>
                      <Space wrap>
                        <Tag className="admin-connection-pill" color={detail?.syndicationTwitterConnected ? "green" : "default"}>
                          {detail?.syndicationTwitterConnected ? t("tenants.twitterConnected") : t("tenants.twitterNotConnected")}
                        </Tag>
                        {can("tenants", "edit") && detail?.syndicationTwitterConnected ? (
                          <Popconfirm
                            title={t("tenants.twitterDisconnectConfirmTitle")}
                            description={t("tenants.twitterDisconnectConfirmDescription")}
                            okText={t("tenants.twitterDisconnect")}
                            okButtonProps={{ danger: true }}
                            cancelText={t("common.cancel")}
                            onConfirm={() => void disconnectNetwork("twitter")}
                          >
                            <Button className="admin-connection-pill" danger loading={disconnectLoading === "twitter"}>
                              {t("tenants.twitterDisconnect")}
                            </Button>
                          </Popconfirm>
                        ) : null}
                      </Space>
                    </Form.Item>
                    {renderNetworkSyndicationSection("twitter")}
                  </div>
                ),
              },
              {
                key: "facebook",
                label: "Facebook",
                children: (
                  <div style={{ maxWidth: 900 }}>
                    <Form.Item label={t("tenants.facebookConnectionLabel")} extra={t("tenants.facebookConnectionHint")}>
                      <Space wrap>
                        <Tag className="admin-connection-pill" color={detail?.syndicationFacebookConnected ? "green" : "default"}>
                          {detail?.syndicationFacebookConnected ? t("tenants.facebookConnected") : t("tenants.facebookNotConnected")}
                        </Tag>
                        {detail?.facebookPageName ? <Tag color="blue">{detail.facebookPageName}</Tag> : null}
                        {can("tenants", "edit") && detail?.syndicationFacebookConnected ? (
                          <Popconfirm
                            title={t("tenants.facebookDisconnectConfirmTitle")}
                            description={t("tenants.facebookDisconnectConfirmDescription")}
                            okText={t("tenants.facebookDisconnect")}
                            okButtonProps={{ danger: true }}
                            cancelText={t("common.cancel")}
                            onConfirm={() => void disconnectNetwork("facebook")}
                          >
                            <Button className="admin-connection-pill" danger loading={disconnectLoading === "facebook"}>
                              {t("tenants.facebookDisconnect")}
                            </Button>
                          </Popconfirm>
                        ) : null}
                      </Space>
                    </Form.Item>
                    <Form.Item
                      label={t("tenants.facebookPageSelectLabel")}
                      extra={t("tenants.facebookPageSelectHint")}
                    >
                      <Space direction="vertical" size={12} style={{ width: "100%" }}>
                        <Table<FacebookPageOption>
                          rowKey="id"
                          size="small"
                          loading={facebookPagesLoading}
                          dataSource={facebookPages}
                          columns={facebookPagesColumns}
                          pagination={false}
                          locale={{ emptyText: t("tenants.facebookPagesEmpty") }}
                          rowSelection={{
                            type: "radio",
                            selectedRowKeys: selectedFacebookPageId ? [selectedFacebookPageId] : [],
                            onChange: (selectedRowKeys) => {
                              const [selectedId] = selectedRowKeys;
                              setSelectedFacebookPageId(String(selectedId || ""));
                            },
                            getCheckboxProps: () => ({
                              disabled: !detail?.syndicationFacebookConnected || !can("tenants", "edit"),
                            }),
                          }}
                          onRow={(record) => ({
                            onClick: () => {
                              if (!detail?.syndicationFacebookConnected || !can("tenants", "edit")) return;
                              setSelectedFacebookPageId(record.id);
                            },
                          })}
                        />
                        {selectedFacebookPageId ? (
                          <Tag color="blue">{t("tenants.facebookPagesTableCurrent", { id: selectedFacebookPageId })}</Tag>
                        ) : null}
                        <Space wrap>
                          <Button
                            onClick={() => void loadFacebookPages()}
                            loading={facebookPagesLoading}
                            disabled={!detail?.syndicationFacebookConnected}
                          >
                            {t("tenants.facebookPagesReload")}
                          </Button>
                          <Button
                            type="primary"
                            onClick={() => void saveFacebookPage()}
                            loading={facebookPageSaving}
                            disabled={!detail?.syndicationFacebookConnected || !can("tenants", "edit")}
                          >
                            {t("tenants.facebookPageSave")}
                          </Button>
                        </Space>
                      </Space>
                    </Form.Item>
                    {renderNetworkSyndicationSection("facebook")}
                  </div>
                ),
              },
              {
                key: "instagram",
                label: "Instagram",
                children: (
                  <div style={{ maxWidth: 900 }}>
                    <Form.Item label={t("tenants.instagramConnectionLabel")} extra={t("tenants.instagramConnectionHint")}>
                      <Space wrap>
                        <Tag className="admin-connection-pill" color={detail?.syndicationInstagramConnected ? "green" : "default"}>
                          {detail?.syndicationInstagramConnected ? t("tenants.instagramConnected") : t("tenants.instagramNotConnected")}
                        </Tag>
                        {detail?.instagramUsername ? <Tag color="purple">@{detail.instagramUsername}</Tag> : null}
                        {can("tenants", "edit") && detail?.syndicationInstagramConnected ? (
                          <Popconfirm
                            title={t("tenants.instagramDisconnectConfirmTitle")}
                            description={t("tenants.instagramDisconnectConfirmDescription")}
                            okText={t("tenants.instagramDisconnect")}
                            okButtonProps={{ danger: true }}
                            cancelText={t("common.cancel")}
                            onConfirm={() => void disconnectNetwork("instagram")}
                          >
                            <Button className="admin-connection-pill" danger loading={disconnectLoading === "instagram"}>
                              {t("tenants.instagramDisconnect")}
                            </Button>
                          </Popconfirm>
                        ) : null}
                      </Space>
                    </Form.Item>
                    {renderNetworkSyndicationSection("instagram")}
                  </div>
                ),
              },
              {
                key: "tiktok",
                label: "TikTok",
                children: (
                  <div style={{ maxWidth: 900 }}>
                    <Form.Item label={t("tenants.tiktokConnectionLabel")} extra={t("tenants.tiktokConnectionHint")}>
                    <Space wrap>
                      <Tag className="admin-connection-pill" color={detail?.syndicationTiktokConnected ? "green" : "default"}>
                        {detail?.syndicationTiktokConnected ? t("tenants.tiktokConnected") : t("tenants.tiktokNotConnected")}
                      </Tag>
                      {detail?.tiktokUsername ? <Tag color="magenta">@{detail.tiktokUsername}</Tag> : null}
                      {can("tenants", "edit") && detail?.syndicationTiktokConnected ? (
                        <Popconfirm
                          title={t("tenants.tiktokDisconnectConfirmTitle")}
                          description={t("tenants.tiktokDisconnectConfirmDescription")}
                          okText={t("tenants.tiktokDisconnect")}
                          okButtonProps={{ danger: true }}
                          cancelText={t("common.cancel")}
                          onConfirm={() => void disconnectNetwork("tiktok")}
                        >
                          <Button className="admin-connection-pill" danger loading={disconnectLoading === "tiktok"}>
                            {t("tenants.tiktokDisconnect")}
                          </Button>
                        </Popconfirm>
                      ) : null}
                    </Space>
                  </Form.Item>
                    {renderNetworkSyndicationSection("tiktok")}
                  </div>
                ),
              },
              {
                key: "metadata",
                label: t("tenants.tabMetadata"),
                children: (
                  <Form.Item name="metadataJson" label={t("tenants.metadataJson")} extra={t("tenants.metadataHint")}>
                    <Input.TextArea rows={12} disabled={!can("tenants", "edit")} />
                  </Form.Item>
                ),
              },
            ]}
          />
        </Form>
      </Spin>
    </div>
  );
}
