import { useCallback, useEffect, useState } from "react";
import { App, Button, Descriptions, Modal, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";

/** One AD-recognition scan row as returned by the admin API. */
export type AdRecognitionScan = {
  id: string;
  tenantId: string;
  channelId: string;
  channelTitle: string | null;
  hlsUrl: string | null;
  detection: string;
  score: number | null;
  confidence: number | null;
  scores: Record<string, number> | null;
  transcript: string | null;
  ocrText: string | null;
  profile: Record<string, unknown> | null;
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
    case "black":
      return "default";
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

function videoCategory(scan: AdRecognitionScan): string {
  const p = scan.profile;
  if (!p || typeof p !== "object") return "—";
  const cat = (p as { video_category_avg?: unknown }).video_category_avg;
  return typeof cat === "string" && cat ? cat : "—";
}

export function StreamScansModal({ open, onClose, tenantId, channelId, channelTitle }: Props) {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [scans, setScans] = useState<AdRecognitionScan[]>([]);

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

  const columns: ColumnsType<AdRecognitionScan> = [
    {
      title: t("streams.scanColTime"),
      key: "time",
      width: 200,
      render: (_, r) => humanTime(r),
    },
    {
      title: t("streams.scanColEpoch"),
      dataIndex: "probeEpoch",
      key: "probeEpoch",
      width: 130,
      render: (v: number | null) => (v != null ? String(v) : "—"),
    },
    {
      title: t("streams.scanColDetection"),
      dataIndex: "detection",
      key: "detection",
      width: 120,
      render: (v: string) => <Tag color={detectionColor(v)}>{v}</Tag>,
    },
    {
      title: t("streams.scanColScore"),
      dataIndex: "score",
      key: "score",
      width: 90,
      render: (v: number | null) => fmtNum(v),
    },
    {
      title: t("streams.scanColConfidence"),
      dataIndex: "confidence",
      key: "confidence",
      width: 110,
      render: (v: number | null) => fmtNum(v),
    },
    {
      title: t("streams.scanColVideoCategory"),
      key: "videoCategory",
      width: 160,
      render: (_, r) => videoCategory(r),
    },
    {
      title: t("streams.scanColError"),
      dataIndex: "error",
      key: "error",
      ellipsis: true,
      render: (v: string | null) => (v ? <Typography.Text type="danger">{v}</Typography.Text> : "—"),
    },
  ];

  const renderExpanded = (scan: AdRecognitionScan) => (
    <Descriptions
      column={1}
      size="small"
      bordered
      styles={{ label: { width: 160, fontWeight: 600 } }}
    >
      <Descriptions.Item label={t("streams.scanColTime")}>{humanTime(scan)}</Descriptions.Item>
      <Descriptions.Item label="m3u8">
        <Typography.Text copyable style={{ wordBreak: "break-all" }}>
          {scan.hlsUrl || "—"}
        </Typography.Text>
      </Descriptions.Item>
      <Descriptions.Item label={t("streams.scanColScores")}>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 200, overflow: "auto" }}>
          {scan.scores ? JSON.stringify(scan.scores, null, 2) : "—"}
        </pre>
      </Descriptions.Item>
      <Descriptions.Item label={t("streams.scanColTranscript")}>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 160, overflow: "auto" }}>
          {scan.transcript || "—"}
        </pre>
      </Descriptions.Item>
      <Descriptions.Item label={t("streams.scanColOcr")}>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 160, overflow: "auto" }}>
          {scan.ocrText || "—"}
        </pre>
      </Descriptions.Item>
      <Descriptions.Item label={t("streams.scanColProfile")}>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 260, overflow: "auto" }}>
          {scan.profile ? JSON.stringify(scan.profile, null, 2) : "—"}
        </pre>
      </Descriptions.Item>
    </Descriptions>
  );

  return (
    <Modal
      title={t("streams.scansModalTitle", { title: channelTitle || channelId })}
      open={open}
      onCancel={onClose}
      footer={null}
      width="80vw"
      style={{ top: 24 }}
      styles={{ body: { maxHeight: "80vh", overflow: "auto" } }}
      destroyOnClose
    >
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography.Text type="secondary">
          {t("streams.scansCount", { count: scans.length })}
        </Typography.Text>
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
    </Modal>
  );
}
