import { Descriptions, Modal, Tabs, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { TranscriptDiarizationPayload } from "@/types/vod-job";

export type AdminClipDetail = Record<string, unknown>;

function pickVideoUrl(c: AdminClipDetail): string {
  const urls = c.outputUrls;
  if (Array.isArray(urls)) {
    const u = urls.find((x) => typeof x === "string" && /^https?:\/\//i.test(String(x).trim()));
    if (u) return String(u).trim();
  }
  const ou = c.outputUrl;
  if (typeof ou === "string" && /^https?:\/\//i.test(ou.trim())) return ou.trim();
  const cu = c.clipUrl;
  if (typeof cu === "string" && /^https?:\/\//i.test(cu.trim())) return cu.trim();
  return "";
}

function formatDiarization(di: unknown): string {
  if (!di || typeof di !== "object") return "";
  const d = di as TranscriptDiarizationPayload;
  if (!Array.isArray(d.segments)) return "";
  const labels = d.speakerLabels && typeof d.speakerLabels === "object" && !Array.isArray(d.speakerLabels) ? d.speakerLabels : {};
  return d.segments
    .map((s) => {
      const id = String(s.speaker || "").trim() || "A";
      const custom = typeof labels[id] === "string" ? (labels[id] as string).trim() : "";
      const name = custom || id;
      const line = String(s.text || "")
        .trim()
        .replace(/\s*\n\s*/g, " ");
      return `- ${name}: ${line}`;
    })
    .join("\n\n");
}

type Props = {
  open: boolean;
  onClose: () => void;
  clip: AdminClipDetail | null;
  loading?: boolean;
};

export function ClipDetailModal({ open, onClose, clip, loading }: Props) {
  const { t } = useTranslation("admin");
  const videoSrc = clip ? pickVideoUrl(clip) : "";
  const transcriptPlain = clip && typeof clip.transcriptText === "string" ? clip.transcriptText : "";
  const diText = clip ? formatDiarization(clip.transcriptDiarization) : "";
  const metaJson = clip ? JSON.stringify(clip, null, 2) : "";

  return (
    <Modal
      title={t("clips.modalTitle")}
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(960px, 96vw)"
      destroyOnClose
    >
      {loading || !clip ? (
        <Typography.Paragraph>{t("common.loading")}</Typography.Paragraph>
      ) : (
        <Tabs
          defaultActiveKey="player"
          items={[
            {
              key: "player",
              label: t("clips.tabPlayer"),
              children: (
                <div>
                  {videoSrc ? (
                    <video key={videoSrc} controls style={{ width: "100%", maxHeight: 420 }} src={videoSrc} />
                  ) : (
                    <Typography.Text type="secondary">{t("clips.noVideo")}</Typography.Text>
                  )}
                </div>
              ),
            },
            {
              key: "meta",
              label: t("clips.tabMetadata"),
              children: (
                <Typography.Paragraph copyable>
                  <pre style={{ margin: 0, maxHeight: 480, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 12 }}>{metaJson}</pre>
                </Typography.Paragraph>
              ),
            },
            {
              key: "transcript",
              label: t("clips.tabTranscript"),
              children: (
                <div>
                  <Descriptions column={1} size="small" title="Plain text" style={{ marginBottom: 16 }}>
                    <Descriptions.Item>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{transcriptPlain || "—"}</pre>
                    </Descriptions.Item>
                  </Descriptions>
                  <Descriptions column={1} size="small" title="Diarization">
                    <Descriptions.Item>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{diText || "—"}</pre>
                    </Descriptions.Item>
                  </Descriptions>
                </div>
              ),
            },
          ]}
        />
      )}
    </Modal>
  );
}
