import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Descriptions, Modal, Progress, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";
import { AdRecognitionSetupTab, type StreamInfo } from "./ad-recognition-setup-tab";
import { AdRecognitionPlayerTab } from "./ad-recognition-player-tab";

/** One AD-recognition scan row as returned by the admin API (rule engine). */
export type AdRecognitionScan = {
  id: string;
  tenantId: string;
  channelId: string;
  channelTitle: string | null;
  hlsUrl: string | null;
  detection: string;
  score: number | null;
  /** Ad/program threshold applied for this scan (stored in the `confidence` column). */
  threshold: number | null;
  /** Per-strategy scores: { logoAppearance, logoDisappearance, ocrRules }. */
  scores: Record<string, number> | null;
  ocrText: string | null;
  ocrTextTranslated: string | null;
  elapsedMs: number | null;
  strategyResults: Record<string, unknown> | null;
  error: string | null;
  probeEpoch: number | null;
  scannedAt: string;
  createdAt: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  channelId: string;
  channelTitle: string;
};

function readErrorMessage(e: unknown, fallback = "Error"): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err.response?.data?.error || err.message || fallback;
}

function detectionColor(detection: string): string {
  switch (detection) {
    case "ad":
      return "green";
    case "program":
      return "gold";
    case "error":
      return "red";
    default:
      return "default";
  }
}

function humanTime(scan: AdRecognitionScan): string {
  const ms = scan.probeEpoch != null ? scan.probeEpoch * 1000 : Date.parse(scan.scannedAt);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

function fmtNum(n: number | null | undefined, digits = 3): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}

/** Friendly labels for the per-strategy score keys. */
const STRATEGY_KEYS = ["logoAppearance", "logoDisappearance", "ocrRules"] as const;

export function StreamScansModal({ open, onClose, tenantId, channelId, channelTitle }: Props) {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [scans, setScans] = useState<AdRecognitionScan[]>([]);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);

  const load = useCallback(async () => {
    if (!tenantId || !channelId) return;
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<{ scans: AdRecognitionScan[] }>(
        `/tenants/${encodeURIComponent(tenantId)}/streams/${encodeURIComponent(channelId)}/scans`,
      );
      setScans(Array.isArray(data?.scans) ? data.scans : []);
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
      setScans([]);
    } finally {
      setLoading(false);
    }
  }, [channelId, message, tenantId]);

  useEffect(() => {
    if (open) void load();
    else setScans([]);
  }, [open, load]);

  // Probe the channel's base resolution / fps + a playable archive URL (best-effort) once per open.
  useEffect(() => {
    if (!open || !tenantId || !channelId) {
      setStreamInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getAdminClient().get<StreamInfo>(
          `/tenants/${encodeURIComponent(tenantId)}/streams/${encodeURIComponent(channelId)}/stream-info`,
        );
        if (!cancelled) setStreamInfo(data || null);
      } catch {
        if (!cancelled) setStreamInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId, channelId]);

  const columns: ColumnsType<AdRecognitionScan> = useMemo(
    () => [
      { title: t("streams.scanColTime"), key: "time", width: 190, render: (_, r) => humanTime(r) },
      {
        title: t("streams.scanColDetection"),
        dataIndex: "detection",
        key: "detection",
        width: 100,
        render: (v: string) => <Tag color={detectionColor(v)}>{v}</Tag>,
      },
      {
        title: t("streams.scanColScore"),
        dataIndex: "score",
        key: "score",
        width: 80,
        render: (v: number | null) => fmtNum(v, 2),
      },
      {
        title: t("streams.scanColThreshold"),
        dataIndex: "threshold",
        key: "threshold",
        width: 90,
        render: (v: number | null) => fmtNum(v, 2),
      },
      {
        title: t("streams.scanColStrategyScores"),
        key: "scores",
        width: 260,
        render: (_, r) => {
          const s = r.scores || {};
          const present = STRATEGY_KEYS.filter((k) => typeof s[k] === "number");
          if (present.length === 0) return "—";
          return (
            <Space wrap size={[4, 4]}>
              {present.map((k) => (
                <Tag key={k} color={(s[k] as number) >= (r.threshold ?? 0.5) ? "volcano" : "blue"}>
                  {t(`adSetup.${k}`)}: {fmtNum(s[k], 2)}
                </Tag>
              ))}
            </Space>
          );
        },
      },
      {
        title: t("streams.scanColDuration"),
        dataIndex: "elapsedMs",
        key: "elapsedMs",
        width: 100,
        render: (v: number | null) => (typeof v === "number" ? `${v} ms` : "—"),
      },
      {
        title: t("streams.scanColError"),
        dataIndex: "error",
        key: "error",
        ellipsis: true,
        render: (v: string | null) => (v ? <Typography.Text type="danger">{v}</Typography.Text> : "—"),
      },
    ],
    [t],
  );

  const renderExpanded = (scan: AdRecognitionScan) => {
    const scores = scan.scores || {};
    const present = STRATEGY_KEYS.filter((k) => typeof scores[k] === "number");

    return (
      <Descriptions column={1} size="small" bordered styles={{ label: { width: 220, fontWeight: 600 } }}>
        <Descriptions.Item label={t("streams.scanColTime")}>{humanTime(scan)}</Descriptions.Item>

        <Descriptions.Item label="m3u8">
          <Typography.Text copyable style={{ wordBreak: "break-all" }}>
            {scan.hlsUrl || "—"}
          </Typography.Text>
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColStrategyScores")}>
          {present.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {present.map((k) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, alignItems: "center" }}>
                  <Typography.Text style={{ fontSize: 12 }}>{t(`adSetup.${k}`)}</Typography.Text>
                  <Progress
                    percent={Math.round((scores[k] as number) * 100)}
                    size="small"
                    showInfo
                    format={() => fmtNum(scores[k], 2)}
                    strokeColor={(scores[k] as number) >= (scan.threshold ?? 0.5) ? "#d4380d" : undefined}
                  />
                </div>
              ))}
            </div>
          ) : (
            "—"
          )}
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColOcrText")}>
          <pre dir="auto" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 140, overflow: "auto" }}>
            {scan.ocrText || "—"}
          </pre>
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColOcrTextTranslated")}>
          <pre dir="auto" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 140, overflow: "auto" }}>
            {scan.ocrTextTranslated || "—"}
          </pre>
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColDuration")}>
          {typeof scan.elapsedMs === "number" ? `${scan.elapsedMs} ms` : "—"}
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColStrategyResults")}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 260, overflow: "auto" }}>
            {scan.strategyResults ? JSON.stringify(scan.strategyResults, null, 2) : "—"}
          </pre>
        </Descriptions.Item>
      </Descriptions>
    );
  };

  const markersTab = (
    <div>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography.Text type="secondary">{t("streams.scansCount", { count: scans.length })}</Typography.Text>
        <Button onClick={() => void load()} loading={loading} size="small">
          {t("streams.reload")}
        </Button>
      </div>
      <Table<AdRecognitionScan>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={scans}
        columns={columns}
        pagination={{ pageSize: 50, showSizeChanger: true }}
        rowClassName={(r) => (r.detection === "program" ? "ad-scan-row-program" : "ad-scan-row-nonprogram")}
        expandable={{ expandedRowRender: renderExpanded }}
        locale={{ emptyText: t("streams.scansEmpty") }}
        scroll={{ x: true }}
      />
    </div>
  );

  return (
    <Modal
      title={t("streams.channelModalTitle", { title: channelTitle || channelId })}
      open={open}
      onCancel={onClose}
      footer={null}
      width="80vw"
      style={{ top: 24 }}
      styles={{ body: { maxHeight: "80vh", overflow: "auto" } }}
      destroyOnClose
    >
      <Tabs
        defaultActiveKey="setup"
        destroyInactiveTabPane
        items={[
          {
            key: "setup",
            label: t("streams.tabAdSetup"),
            children: open ? (
              <AdRecognitionSetupTab
                tenantId={tenantId}
                channelId={channelId}
                streamInfo={streamInfo}
                onMarkersPurged={() => void load()}
              />
            ) : null,
          },
          {
            key: "player",
            label: t("streams.tabPlayer"),
            children: open ? (
              <AdRecognitionPlayerTab playerUrl={streamInfo?.playerUrl ?? null} streamInfo={streamInfo} />
            ) : null,
          },
          { key: "markers", label: t("streams.tabMarkers"), children: markersTab },
        ]}
      />
    </Modal>
  );
}
