import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Descriptions, Modal, Progress, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { getAdminClient } from "@/admin/admin-api";

/** Shape of a single CLAP chunk inside `profile.audio_clap_chunks`. */
type ClapChunk = {
  startSec?: number;
  endSec?: number;
  category?: string;
  score?: number;
};

/**
 * Multimodal profile produced by insight-ad-recognition. We only declare the fields the modal
 * renders; anything else the raw JSON viewer at the bottom still shows verbatim.
 */
type MultimodalProfile = {
  // Local video metrics.
  blackscreen_ratio?: number;
  motion_avg?: number;
  scene_change_rate?: number;

  // Local audio metrics.
  audio_rms?: number;
  audio_dynamic_range?: number;
  speech_ratio?: number;
  music_probability?: number;
  silence_ratio?: number;

  // Visual (SigLIP).
  video_category_avg?: string;
  video_category_score_avg?: number;
  video_per_category?: Record<string, number>;

  // OCR text + cues.
  ocr_text?: string;
  ocr_word_count?: number;
  ocr_short_code?: boolean;
  ocr_phone?: boolean;
  ocr_price?: boolean;
  ocr_percent?: boolean;
  ocr_url?: boolean;
  ocr_installments?: boolean;
  ocr_cta?: boolean;
  ocr_legal?: boolean;
  ocr_ad_cue_count?: number;

  // Overlay detection.
  overlay_present?: boolean;
  lower_third_present?: boolean;
  banner_present?: boolean;
  logo_region_present?: boolean;
  overlay_score?: number;
  overlay_frame_ratio?: number;

  // BERT semantic labels.
  text_category?: string;
  text_labels?: Record<string, number>;

  // Audio (CLAP).
  audio_clap_category_avg?: string;
  audio_clap_score_avg?: number;
  audio_clap_per_category?: Record<string, number>;
  audio_clap_last?: { startSec?: number; endSec?: number; category?: string; score?: number } | null;
  audio_clap_chunks?: ClapChunk[];
  audio_clap_chunk_seconds?: number;

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
  ocrText: string | null;
  visualCategory: string | null;
  audioCategory: string | null;
  ocrAdCueCount: number | null;
  overlayPresent: boolean | null;
  profile: MultimodalProfile | null;
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
    // The pipeline emits "silence"; keep legacy "black" handled so historical rows still render.
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

/** SigLIP visual categories treated as ad-like. */
const VISUAL_AD = new Set(["publicidad", "placa", "institucional"]);
/** CLAP audio categories treated as ad-like. */
function isAudioAdCategory(cat: string | undefined | null): boolean {
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
      { title: t("streams.scanColTime"), key: "time", width: 190, render: (_, r) => humanTime(r) },
      {
        title: t("streams.scanColDetection"),
        dataIndex: "detection",
        key: "detection",
        width: 110,
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
        title: t("streams.scanColVisualCategory"),
        dataIndex: "visualCategory",
        key: "visualCategory",
        width: 130,
        render: (v: string | null) =>
          v ? <Tag color={VISUAL_AD.has(v) ? "volcano" : "blue"}>{v}</Tag> : "—",
      },
      {
        title: t("streams.scanColAudioCategory"),
        dataIndex: "audioCategory",
        key: "audioCategory",
        width: 170,
        render: (v: string | null) =>
          v ? <Tag color={isAudioAdCategory(v) ? "volcano" : "blue"}>{v}</Tag> : "—",
      },
      {
        title: t("streams.scanColOcrCues"),
        dataIndex: "ocrAdCueCount",
        key: "ocrAdCueCount",
        width: 90,
        render: (v: number | null) =>
          typeof v === "number" && v > 0 ? <Tag color="volcano">{v}</Tag> : <Tag>0</Tag>,
      },
      {
        title: t("streams.scanColOverlay"),
        dataIndex: "overlayPresent",
        key: "overlayPresent",
        width: 90,
        render: (v: boolean | null) =>
          v ? <Tag color="volcano">✓</Tag> : <Tag>—</Tag>,
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
    const profile = scan.profile;
    const last = profile?.audio_clap_last || null;
    const chunks = Array.isArray(profile?.audio_clap_chunks) ? profile!.audio_clap_chunks! : [];
    const visualPer = profile?.video_per_category || {};
    const clapPer = profile?.audio_clap_per_category || {};
    const textLabels = profile?.text_labels || {};
    const chunkSeconds = profile?.audio_clap_chunk_seconds;

    const sortDesc = (obj: Record<string, number>) =>
      Object.entries(obj)
        .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
        .sort((a, b) => (b[1] as number) - (a[1] as number));

    // OCR cue chips (only the ones that fired).
    const cueChips: string[] = [];
    if (profile?.ocr_short_code) cueChips.push("short-code");
    if (profile?.ocr_phone) cueChips.push("phone");
    if (profile?.ocr_price) cueChips.push("price");
    if (profile?.ocr_percent) cueChips.push("%");
    if (profile?.ocr_url) cueChips.push("url");
    if (profile?.ocr_installments) cueChips.push("installments");
    if (profile?.ocr_cta) cueChips.push("cta");
    if (profile?.ocr_legal) cueChips.push("legal");

    // Overlay flag chips.
    const overlayChips: string[] = [];
    if (profile?.lower_third_present) overlayChips.push("lower-third");
    if (profile?.banner_present) overlayChips.push("banner");
    if (profile?.logo_region_present) overlayChips.push("logo");

    return (
      <Descriptions column={1} size="small" bordered styles={{ label: { width: 220, fontWeight: 600 } }}>
        <Descriptions.Item label={t("streams.scanColTime")}>{humanTime(scan)}</Descriptions.Item>

        <Descriptions.Item label="m3u8">
          <Typography.Text copyable style={{ wordBreak: "break-all" }}>
            {scan.hlsUrl || "—"}
          </Typography.Text>
        </Descriptions.Item>

        {/* ---- Visual (SigLIP) ---- */}
        <Descriptions.Item label={t("streams.scanColVisualDistribution")}>
          {sortDesc(visualPer).length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sortDesc(visualPer).map(([cat, val]) => (
                <div key={cat} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, alignItems: "center" }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    {VISUAL_AD.has(cat) ? <Tag color="volcano">{cat}</Tag> : cat}
                  </Typography.Text>
                  <Progress
                    percent={Math.round((val as number) * 100)}
                    size="small"
                    showInfo
                    format={() => fmtPct(val as number)}
                    strokeColor={VISUAL_AD.has(cat) ? "#d4380d" : undefined}
                  />
                </div>
              ))}
            </div>
          ) : (
            "—"
          )}
        </Descriptions.Item>

        {/* ---- OCR text + cues (Hebrew-aware, RTL) ---- */}
        <Descriptions.Item label={t("streams.scanColOcrCues")}>
          {cueChips.length ? (
            <Space wrap size={[4, 4]}>
              {cueChips.map((c) => (
                <Tag key={c} color="volcano">
                  {c}
                </Tag>
              ))}
            </Space>
          ) : (
            <Typography.Text type="secondary">{t("streams.scanNoCues")}</Typography.Text>
          )}
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColOcrText")}>
          <pre
            dir="auto"
            style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 140, overflow: "auto" }}
          >
            {scan.ocrText || profile?.ocr_text || "—"}
          </pre>
        </Descriptions.Item>

        {/* ---- BERT semantic labels ---- */}
        <Descriptions.Item label={t("streams.scanColTextLabels")}>
          {sortDesc(textLabels).length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sortDesc(textLabels).map(([label, val]) => (
                <div key={label} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center" }}>
                  <Typography.Text style={{ fontSize: 12 }}>{label}</Typography.Text>
                  <Progress
                    percent={Math.round((val as number) * 100)}
                    size="small"
                    showInfo
                    format={() => fmtPct(val as number)}
                    strokeColor={label !== "program" ? "#d4380d" : undefined}
                  />
                </div>
              ))}
            </div>
          ) : (
            "—"
          )}
        </Descriptions.Item>

        {/* ---- Overlay detection ---- */}
        <Descriptions.Item label={t("streams.scanColOverlay")}>
          <Space wrap size={[4, 4]}>
            <Tag color={profile?.overlay_present ? "volcano" : "default"}>
              {profile?.overlay_present ? t("streams.scanOverlayPresent") : t("streams.scanOverlayAbsent")}
            </Tag>
            {overlayChips.map((c) => (
              <Tag key={c}>{c}</Tag>
            ))}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              score {fmtNum(profile?.overlay_score, 2)} · {fmtPct(profile?.overlay_frame_ratio)}
            </Typography.Text>
          </Space>
        </Descriptions.Item>

        {/* ---- Audio (CLAP) ---- */}
        <Descriptions.Item label={t("streams.scanColClapLast")}>
          {last ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div>
                <Tag color={isAudioAdCategory(last.category) ? "volcano" : "blue"}>{last.category || "—"}</Tag>
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
                      v ? <Tag color={isAudioAdCategory(v) ? "volcano" : "blue"}>{v}</Tag> : "—",
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
          {sortDesc(clapPer).length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sortDesc(clapPer).map(([cat, val]) => (
                <div key={cat} style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, alignItems: "center" }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    {isAudioAdCategory(cat) ? <Tag color="volcano">{cat}</Tag> : cat}
                  </Typography.Text>
                  <Progress
                    percent={Math.round((val as number) * 100)}
                    size="small"
                    showInfo
                    format={() => fmtPct(val as number)}
                    strokeColor={isAudioAdCategory(cat) ? "#d4380d" : undefined}
                  />
                </div>
              ))}
            </div>
          ) : (
            "—"
          )}
        </Descriptions.Item>

        {/* ---- Audio + video metrics ---- */}
        <Descriptions.Item label={t("streams.scanColAudioMetrics")}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 4, fontSize: 12 }}>
            <div>
              <Typography.Text type="secondary">RMS: </Typography.Text>
              {fmtNum(profile?.audio_rms, 2)}
            </div>
            <div>
              <Typography.Text type="secondary">{t("streams.scanAudioDynamicRange")}: </Typography.Text>
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
            <div>
              <Typography.Text type="secondary">{t("streams.scanVideoSceneChange")}: </Typography.Text>
              {fmtPct(profile?.scene_change_rate)}
            </div>
            <div>
              <Typography.Text type="secondary">{t("streams.scanVideoBlackscreen")}: </Typography.Text>
              {fmtPct(profile?.blackscreen_ratio)}
            </div>
          </div>
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColScores")}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 120, overflow: "auto" }}>
            {scan.scores ? JSON.stringify(scan.scores, null, 2) : "—"}
          </pre>
        </Descriptions.Item>

        <Descriptions.Item label={t("streams.scanColTranscript")}>
          <pre dir="auto" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 140, overflow: "auto" }}>
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
    </Modal>
  );
}
