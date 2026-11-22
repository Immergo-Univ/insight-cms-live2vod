import { useTranslation } from "react-i18next";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import type { InsightVodDocument, InsightVodNewsEntry, InsightVodTranscriptEntry } from "@/types/insight-vod";
import { VodAiNewsTab, VodAiTranscriptTab } from "./vod-ai-content-tabs";

export type VodAiEditorKind = "stt" | "article";

interface VodAiEditorModalProps {
  kind: VodAiEditorKind | null;
  initialLocale?: string;
  vod: InsightVodDocument;
  jobId?: string | null;
  defaultPosterUrl?: string | null;
  saving: boolean;
  onClose: () => void;
  onSaveNews: (news: InsightVodNewsEntry[]) => Promise<void>;
  onSaveTranscript: (transcript: InsightVodTranscriptEntry[]) => Promise<void>;
}

/** "Edit / View" dialog for Speech-to-text and News article results. */
export function VodAiEditorModal({
  kind,
  initialLocale,
  vod,
  jobId,
  defaultPosterUrl,
  saving,
  onClose,
  onSaveNews,
  onSaveTranscript,
}: VodAiEditorModalProps) {
  const { t } = useTranslation("vodAi");
  const title = kind === "article" ? t("editor.newsTitle") : t("editor.transcriptTitle");

  return (
    <ModalOverlay isOpen={kind !== null} onOpenChange={(open) => !open && onClose()} isDismissable>
      <Modal className="max-w-[1100px]">
        <Dialog aria-label={title}>
          <div className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-xl bg-primary shadow-xl">
            <div className="flex items-center gap-3 border-b border-secondary px-6 py-4">
              <h2 className="m-0 text-lg font-semibold text-primary">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("editor.close")}
                className="ml-auto px-2 py-1 text-2xl leading-none text-tertiary hover:text-primary"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {kind === "stt" ? (
                <VodAiTranscriptTab vod={vod} saving={saving} onSave={onSaveTranscript} initialLocale={initialLocale} />
              ) : null}
              {kind === "article" ? (
                <VodAiNewsTab
                  vod={vod}
                  jobId={jobId}
                  defaultPosterUrl={defaultPosterUrl}
                  saving={saving}
                  onSave={onSaveNews}
                  initialLocale={initialLocale}
                />
              ) : null}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
