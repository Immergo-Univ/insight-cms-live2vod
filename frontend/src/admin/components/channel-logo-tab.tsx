import { useCallback, useEffect, useState } from "react";
import { App, Button, Col, Empty, Popconfirm, Progress, Row, Spin, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";

/** One auto-collected channel logo sample (ROI crop stored in S3). */
type LogoSample = {
  id: string;
  channelId: string;
  tenantId: string;
  publicUrl: string | null;
  roi: { x0: number; y0: number; x1: number; y1: number } | null;
  confidence: number | null;
  source: string;
  createdAt: string;
};

type Props = {
  tenantId: string;
  channelId: string;
};

function readErrorMessage(e: unknown, fallback = "Error"): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err.response?.data?.error || err.message || fallback;
}

function fmtRoi(roi: LogoSample["roi"]): string {
  if (!roi) return "—";
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `x:${pct(roi.x0)}–${pct(roi.x1)} · y:${pct(roi.y0)}–${pct(roi.y1)}`;
}

/**
 * "Logo Recognition" tab: catalog of the channel's auto-collected logo ROI samples (used to detect
 * when the logo disappears = ad). Shows collection progress toward the target, the detected ROI,
 * and lets the operator delete samples (deleting drops below target so collection resumes).
 */
export function ChannelLogoTab({ tenantId, channelId }: Props) {
  const { t } = useTranslation("admin");
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [samples, setSamples] = useState<LogoSample[]>([]);
  const [target, setTarget] = useState(30);

  const load = useCallback(async () => {
    if (!tenantId || !channelId) return;
    setLoading(true);
    try {
      const { data } = await getAdminClient().get<{ samples: LogoSample[]; target: number }>(
        `/tenants/${encodeURIComponent(tenantId)}/streams/${encodeURIComponent(channelId)}/logo-samples`,
      );
      setSamples(Array.isArray(data?.samples) ? data.samples : []);
      if (typeof data?.target === "number") setTarget(data.target);
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
      setSamples([]);
    } finally {
      setLoading(false);
    }
  }, [channelId, message, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeSample = async (id: string) => {
    setDeleting(id);
    try {
      await getAdminClient().delete(
        `/tenants/${encodeURIComponent(tenantId)}/streams/${encodeURIComponent(channelId)}/logo-samples/${encodeURIComponent(id)}`,
      );
      setSamples((prev) => prev.filter((s) => s.id !== id));
    } catch (e: unknown) {
      message.error(readErrorMessage(e));
    } finally {
      setDeleting(null);
    }
  };

  const roi = samples.find((s) => s.roi)?.roi ?? null;
  const pct = target > 0 ? Math.min(100, Math.round((samples.length / target) * 100)) : 0;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text strong>
          {t("streams.logoSamplesProgress", { count: samples.length, target })}
        </Typography.Text>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
          <Progress percent={pct} style={{ maxWidth: 360 }} status={pct >= 100 ? "success" : "active"} />
          <Button size="small" onClick={() => void load()} loading={loading}>
            {t("streams.reload")}
          </Button>
        </div>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          {t("streams.logoRecognitionHint")}
        </Typography.Paragraph>
        {roi && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("streams.logoRoiLabel")}: <Tag>{fmtRoi(roi)}</Tag>
          </Typography.Text>
        )}
      </div>

      {loading && samples.length === 0 ? (
        <div style={{ textAlign: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : samples.length === 0 ? (
        <Empty description={t("streams.logoSamplesEmpty")} />
      ) : (
        <Row gutter={[12, 12]}>
          {samples.map((s) => (
            <Col key={s.id} xs={12} sm={8} md={6} lg={4}>
              <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 6, padding: 6 }}>
                <div
                  style={{
                    background: "#0c0c0c",
                    borderRadius: 4,
                    minHeight: 60,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {s.publicUrl ? (
                    <img
                      src={s.publicUrl}
                      alt="logo sample"
                      style={{ maxWidth: "100%", maxHeight: 120, display: "block" }}
                    />
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      —
                    </Typography.Text>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {typeof s.confidence === "number" ? s.confidence.toFixed(2) : "—"}
                    {s.source === "manual" ? " ·✎" : ""}
                  </Typography.Text>
                  <Popconfirm
                    title={t("streams.logoSampleDeleteConfirm")}
                    okText={t("common.delete")}
                    okButtonProps={{ danger: true }}
                    cancelText={t("common.cancel")}
                    onConfirm={() => void removeSample(s.id)}
                  >
                    <Button size="small" danger type="text" loading={deleting === s.id}>
                      {t("common.delete")}
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}

export default ChannelLogoTab;
