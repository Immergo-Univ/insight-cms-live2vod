import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Descriptions, Modal, Progress, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";

/**
 * Shape of a single CLAP chunk inside `profile.audio_clap_chunks`. Kept loose because the field
 * is stored as JSONB and may include future keys we haven't declared here yet.
 */
type ClapChunk = {
  startSec?: number;
  endSec?: number;
  category?: string;
  score?: number;
};

/**
 * Audio-only profile shape produced by insight-ad-recognition. We only declare the fields the
 * modal renders; anything else the raw JSON viewer at the bottom still shows verbatim.
 */
type AudioProfile = {
  audio_clap_category_avg?: string;
  audio_clap_score_avg?: number;
  audio_clap_per_category?: Record<string, number>;
  audio_clap_last?: {
    startSec?: number;
    endSec?: number;
    category?: string;
    score?: number;
  } | null;
  audio_clap_chunks?: ClapChunk[];
  audio_clap_chunk_seconds?: number;

  audio_rms?: number;
  audio_dynamic_range?: number;
  speech_ratio?: number;
  music_probability?: number;
  silence_ratio?: number;

  duration?: number;
  confidence?: number;
};

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
  /**
   * Preserved for backwards-compat with pre-CLAP scans. The audio-only pipeline always writes
   * an empty string, so the modal no longer renders it as a dedicated field.
   */
  ocrText: string | null;
  profile: AudioProfile | null;
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
    // The audio-only pipeline emits "silence" instead of the legacy "black" verdict; keep both
    // handled so historical rows still render with a sensible color.
    case "silence":
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

function fmtSec(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1)}s` : "—";
}

function fmtPct(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

/**
 * The category that the classifier ultimately trusted most: the last chunk (live edge) when we
 * have it, falling back to the window-average category from CLAP.
 */
function audioCategory(scan: AdRecognitionScan): string {
  const p = scan.profile;
  if (!p) return "—";
  const last = p.audio_clap_last?.category;
  if (typeof last === "string" && last) return last;
  const avg = p.audio_clap_category_avg;
  return typeof avg === "string" && avg ? avg : "—";
}

/** True when the classifier flagged this category name as ad content. */
function isAdCategory(cat: string | undefined | null): boolean {
  if (!cat) return false;
  return cat === "Television commercial" || cat === "Advertisement";
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

  const columns: ColumnsType<AdRecognitionScan> = useMemo(
    () => [
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
        title: t("streams.scanColAudioCategory"),
        key: "audioCategory",
        width: 200,
        render: (_, r) => {
          const cat = audioCategory(r);
          if (cat === "—") return cat;
          return <Tag color={isAdCategory(cat) ? "volcano" : "blue"}>{cat}</Tag>;
        },
      },
      {
        title: t("streams.scanColError"),
        dataIndex: "error",
        key: "error",
        ellipsis: true,
        render: (v: string | null) =>
          v ? <Typography.Text type="danger">{v}</Typography.Text> : "—",
      },
    ],
    [t],
  );

  const renderExpanded = (scan: AdRecognitionScan) => {
    const profile = scan.profile;
    const last = profile?.audio_clap_last || null;
    const chunks = Array.isArray(profile?.audio_clap_chunks) ? profile!.audio_clap_chunks! : [];
    const perCategory = profile?.audio_clap_per_category || {};
    const chunkSeconds = profile?.audio_clap_chunk_seconds;

    // Sort per-category distribution descending so the strongest signals surface first.
    const sortedCategories = Object.entries(perCategory)
      .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => (b[1] as number) - (a[1] as number));

    return (
      <Descriptions
        column={1}
        size="small"
        bordered
        styles={{ label: { width: 220, fontWeight: 600 } }}
      >
        <Descriptions.Item label={t("streams.scanColTime")}>{humanTime(scan)}</Descriptions.Item>

        <Descriptions.Item label="m3u8">
          <Typography.Text copyable style={{ wordBreak: "break-all" }}>
            {scan.hlsUrl || "—"}
          </Typography.Text>
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColClapLast")}>
          {last ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div>
                <Tag color={isAdCategory(last.category) ? "volcano" : "blue"}>
                  {last.category || "—"}
                </Tag>
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  {fmtSec(last.startSec)} → {fmtSec(last.endSec)}
                </Typography.Text>
              </div>
              <Progress
                percent={typeof last.score === "number" ? Math.round(last.score * 100) : 0}
                size="small"
                showInfo
                format={() => fmtNum(last.score, 2)}
              />
            </div>
          ) : (
            "—"
          )}
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColClapTimeline")}>
          {chunks.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {typeof chunkSeconds === "number" && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("streams.scanClapChunkSize", { seconds: chunkSeconds })}
                </Typography.Text>
              )}
              <Table<ClapChunk>
                size="small"
                pagination={false}
                rowKey={(c) => `${c.startSec}-${c.endSec}-${c.category}`}
                dataSource={chunks}
                columns={[
                  {
                    title: t("streams.scanClapChunkRange"),
                    key: "range",
                    width: 130,
                    render: (_, c) => `${fmtSec(c.startSec)} → ${fmtSec(c.endSec)}`,
                  },
                  {
                    title: t("streams.scanClapChunkCategory"),
                    dataIndex: "category",
                    key: "category",
                    render: (v: string | undefined) =>
                      v ? (
                        <Tag color={isAdCategory(v) ? "volcano" : "blue"}>{v}</Tag>
                      ) : (
                        "—"
                      ),
                  },
                  {
                    title: t("streams.scanClapChunkScore"),
                    dataIndex: "score",
                    key: "score",
                    width: 200,
                    render: (v: number | undefined) => (
                      <Progress
                        percent={typeof v === "number" ? Math.round(v * 100) : 0}
                        size="small"
                        showInfo
                        format={() => fmtNum(v, 2)}
                      />
                    ),
                  },
                ]}
              />
            </div>
          ) : (
            "—"
          )}
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColClapDistribution")}>
          {sortedCategories.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sortedCategories.map(([cat, val]) => (
                <div
                  key={cat}
                  style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, alignItems: "center" }}
                >
                  <Typography.Text style={{ fontSize: 12 }}>
                    {isAdCategory(cat) ? <Tag color="volcano">{cat}</Tag> : cat}
                  </Typography.Text>
                  <Progress
                    percent={Math.round((val as number) * 100)}
                    size="small"
                    showInfo
                    format={() => fmtPct(val as number)}
                    strokeColor={isAdCategory(cat) ? "#d4380d" : undefined}
                  />
                </div>
              ))}
            </div>
          ) : (
            "—"
          )}
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColAudioMetrics")}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 4, fontSize: 12 }}>
            <div>
              <Typography.Text type="secondary">RMS: </Typography.Text>
              {fmtNum(profile?.audio_rms, 2)}
            </div>
            <div>
              <Typography.Text type="secondary">
                {t("streams.scanAudioDynamicRange")}:{" "}
              </Typography.Text>
              {fmtNum(profile?.audio_dynamic_range, 2)}
            </div>
            <div>
              <Typography.Text type="secondary">{t("streams.scanAudioSpeechRatio")}: </Typography.Text>
              {fmtPct(profile?.speech_ratio)}
            </div>
            <div>
              <Typography.Text type="secondary">{t("streams.scanAudioMusicProbability")}: </Typography.Text>
              {fmtPct(profile?.music_probability)}
            </div>
            <div>
              <Typography.Text type="secondary">{t("streams.scanAudioSilenceRatio")}: </Typography.Text>
              {fmtPct(profile?.silence_ratio)}
            </div>
          </div>
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColScores")}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 160, overflow: "auto" }}>
            {scan.scores ? JSON.stringify(scan.scores, null, 2) : "—"}
          </pre>
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColTranscript")}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 160, overflow: "auto" }}>
            {scan.transcript || "—"}
          </pre>
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColProfile")}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 260, overflow: "auto" }}>
            {profile ? JSON.stringify(profile, null, 2) : "—"}
          </pre>
        </Descriptions.Item>
      </Descriptions>
    );
  };

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
