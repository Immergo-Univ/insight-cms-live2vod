import { useCallback, useEffect, useMemo, useState } from "react";
import { Save01 } from "@untitledui/icons";
import { Tabs } from "@/components/application/tabs/tabs";
import { Badge } from "@/components/base/badges/badges";
import { TranscriptNewsLocalePanel } from "@/components/editor/transcript-news-locale-panel";
import { whisperLanguageLabel } from "@/types/editor-whisper-languages";
import type {
  InsightVodDocument,
  InsightVodNewsEntry,
  InsightVodTranscriptEntry,
} from "@/types/insight-vod";
import {
  emptyNewsLocaleBlock,
  insightNewsToLocaleBlock,
  localeBlockToInsightNews,
} from "@/types/insight-vod";
import type { TranscriptDiarizationPayload, TranscriptNewsLocaleBlock } from "@/types/vod-job";
import {
  collectUniqueSpeakerIds,
  defaultSpeakerDisplayName,
  rebuildTranscriptPreviewText,
} from "@/utils/transcript-diarization";
import { cx } from "@/utils/cx";

function rebuildTextFromDiarization(di: TranscriptDiarizationPayload): string {
  return rebuildTranscriptPreviewText(di);
}

interface VodAiNewsTabProps {
  vod: InsightVodDocument;
  jobId?: string | null;
  defaultPosterUrl?: string | null;
  saving: boolean;
  onSave: (news: InsightVodNewsEntry[]) => Promise<void>;
}

export function VodAiNewsTab({ vod, jobId, defaultPosterUrl, saving, onSave }: VodAiNewsTabProps) {
  const initialNews = useMemo(
    () => (Array.isArray(vod.news) ? vod.news : []).filter((n) => n?.languageCode),
    [vod],
  );

  const [news, setNews] = useState<InsightVodNewsEntry[]>(initialNews);
  const [selectedLocale, setSelectedLocale] = useState<string>(
    () => initialNews[0]?.languageCode || "",
  );
  const [err, setErr] = useState<string | null>(null);
  const contentStamp = String(vod.updated ?? vod._id ?? "");

  useEffect(() => {
    const next = (Array.isArray(vod.news) ? vod.news : []).filter((n) => n?.languageCode);
    setNews(next);
    setSelectedLocale((prev) => {
      if (prev && next.some((n) => n.languageCode === prev)) return prev;
      return next[0]?.languageCode || "";
    });
    setErr(null);
  }, [vod]);

  const locales = useMemo(() => news.map((n) => n.languageCode), [news]);

  const selectedEntry = useMemo(
    () => news.find((n) => n.languageCode === selectedLocale) ?? null,
    [news, selectedLocale],
  );

  const selectedBlock = useMemo(
    () => (selectedEntry ? insightNewsToLocaleBlock(selectedEntry) : emptyNewsLocaleBlock()),
    [selectedEntry],
  );

  const handleBlockChange = useCallback(
    (next: TranscriptNewsLocaleBlock) => {
      if (!selectedLocale) return;
      const language = selectedEntry?.language || whisperLanguageLabel(selectedLocale).toLowerCase();
      const entry = localeBlockToInsightNews(selectedLocale, language, next);
      setNews((prev) => {
        const idx = prev.findIndex((n) => n.languageCode === selectedLocale);
        if (idx < 0) return [...prev, entry];
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      });
    },
    [selectedLocale, selectedEntry?.language],
  );

  const handleSave = useCallback(async () => {
    setErr(null);
    try {
      await onSave(news);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save news");
    }
  }, [news, onSave]);

  if (locales.length === 0) {
    return (
      <div className="rounded-lg border border-secondary bg-secondary/30 px-4 py-6 text-sm text-tertiary">
        No AI news drafts on this VOD yet.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 px-1 py-1">
        {locales.map((code) => {
          const active = code === selectedLocale;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setSelectedLocale(code)}
              className={cx(
                "rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
                active ? "ring-2 ring-fg-brand-primary_alt ring-offset-1 ring-offset-primary" : "",
              )}
              aria-pressed={active}
            >
              <Badge type="pill-color" size="md" color={active ? "brand" : "gray"}>
                {whisperLanguageLabel(code)}
              </Badge>
            </button>
          );
        })}
        <div className="ml-auto">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-secondary bg-secondary px-3 py-1.5 text-xs font-medium text-primary hover:bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save01 className="size-3.5" aria-hidden />
            {saving ? "Saving…" : "Save news"}
          </button>
        </div>
      </div>
      {err ? <p className="text-xs text-error-primary">{err}</p> : null}
      {selectedLocale ? (
        <TranscriptNewsLocalePanel
          locale={selectedLocale}
          jobId={jobId || undefined}
          jobContentStamp={`${contentStamp}:${selectedLocale}`}
          block={selectedBlock}
          onChange={handleBlockChange}
          defaultPosterUrl={defaultPosterUrl || undefined}
        />
      ) : null}
    </div>
  );
}

interface VodAiTranscriptTabProps {
  vod: InsightVodDocument;
  saving: boolean;
  onSave: (transcript: InsightVodTranscriptEntry[]) => Promise<void>;
}

export function VodAiTranscriptTab({ vod, saving, onSave }: VodAiTranscriptTabProps) {
  const initial = useMemo(
    () => (Array.isArray(vod.transcript) ? vod.transcript : []).filter((t) => t?.languageCode),
    [vod],
  );

  const [entries, setEntries] = useState<InsightVodTranscriptEntry[]>(initial);
  const [selectedLocale, setSelectedLocale] = useState<string>(
    () => initial[0]?.languageCode || "",
  );
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const next = (Array.isArray(vod.transcript) ? vod.transcript : []).filter((t) => t?.languageCode);
    setEntries(next);
    setSelectedLocale((prev) => {
      if (prev && next.some((t) => t.languageCode === prev)) return prev;
      return next[0]?.languageCode || "";
    });
    setErr(null);
  }, [vod]);

  const locales = useMemo(() => entries.map((t) => t.languageCode), [entries]);
  const selected = useMemo(
    () => entries.find((t) => t.languageCode === selectedLocale) ?? null,
    [entries, selectedLocale],
  );

  const di = selected?.diarization ?? null;
  const hasDi = Boolean(di && Array.isArray(di.segments) && di.segments.length > 0);
  const speakerIds = useMemo(() => (hasDi && di ? collectUniqueSpeakerIds(di) : []), [hasDi, di]);

  const previewText = useMemo(() => {
    if (hasDi && di) return rebuildTextFromDiarization(di);
    return selected?.text?.trim() ?? "";
  }, [hasDi, di, selected?.text]);

  const updateSelected = useCallback(
    (patch: Partial<InsightVodTranscriptEntry>) => {
      if (!selectedLocale) return;
      setEntries((prev) =>
        prev.map((t) => (t.languageCode === selectedLocale ? { ...t, ...patch } : t)),
      );
    },
    [selectedLocale],
  );

  const handleLabelChange = useCallback(
    (speakerId: string, value: string) => {
      if (!selected || !di) return;
      const nextDi: TranscriptDiarizationPayload = {
        ...di,
        speakerLabels: { ...(di.speakerLabels ?? {}), [speakerId]: value },
      };
      updateSelected({
        diarization: nextDi,
        text: rebuildTextFromDiarization(nextDi),
      });
    },
    [selected, di, updateSelected],
  );

  const handleTextChange = useCallback(
    (text: string) => {
      updateSelected({ text });
    },
    [updateSelected],
  );

  const handleSave = useCallback(async () => {
    setErr(null);
    try {
      await onSave(entries);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save transcript");
    }
  }, [entries, onSave]);

  if (locales.length === 0) {
    return (
      <div className="rounded-lg border border-secondary bg-secondary/30 px-4 py-6 text-sm text-tertiary">
        No transcript on this VOD yet.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 px-1 py-1">
        {locales.map((code) => {
          const active = code === selectedLocale;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setSelectedLocale(code)}
              className={cx(
                "rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
                active ? "ring-2 ring-fg-brand-primary_alt ring-offset-1 ring-offset-primary" : "",
              )}
              aria-pressed={active}
            >
              <Badge type="pill-color" size="md" color={active ? "brand" : "gray"}>
                {whisperLanguageLabel(code)}
              </Badge>
            </button>
          );
        })}
        <div className="ml-auto">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-secondary bg-secondary px-3 py-1.5 text-xs font-medium text-primary hover:bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save01 className="size-3.5" aria-hidden />
            {saving ? "Saving…" : "Save transcript"}
          </button>
        </div>
      </div>
      {err ? <p className="text-xs text-error-primary">{err}</p> : null}

      {hasDi && speakerIds.length > 0 ? (
        <div className="rounded-lg border border-secondary bg-secondary/40 px-3 py-2.5">
          <p className="text-xs font-medium text-secondary">Speakers</p>
          <p className="mt-0.5 text-[11px] text-tertiary">
            Override display names for each system speaker id. Empty uses the default label (e.g. Speaker A).
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {speakerIds.map((id) => (
              <li key={id} className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                <span className="shrink-0 font-mono text-[11px] text-tertiary">{id}</span>
                <input
                  type="text"
                  className="min-w-0 flex-1 rounded border border-secondary bg-primary px-2 py-1 text-sm text-primary outline-none placeholder:text-placeholder"
                  placeholder={defaultSpeakerDisplayName(id)}
                  value={di?.speakerLabels?.[id] ?? ""}
                  onChange={(e) => handleLabelChange(id, e.target.value)}
                  aria-label={`Display name for speaker ${id}`}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <label className="flex min-w-0 flex-col gap-0.5 text-xs font-medium text-secondary">
        Transcript text
        <textarea
          rows={16}
          lang={selectedLocale}
          dir={selectedLocale === "he" || selectedLocale === "ar" ? "rtl" : "ltr"}
          className="min-h-[16rem] resize-y rounded border border-secondary bg-primary px-3 py-2 font-mono text-sm leading-relaxed text-primary outline-none"
          value={hasDi ? previewText : selected?.text ?? ""}
          onChange={(e) => handleTextChange(e.target.value)}
          readOnly={hasDi}
          title={hasDi ? "Edit speaker names above to update diarized transcript text" : undefined}
        />
      </label>
      {hasDi ? (
        <p className="text-[11px] text-tertiary">
          Text is rebuilt from diarization segments when speaker labels change. Free-text edit is available when
          diarization is absent.
        </p>
      ) : null}
    </div>
  );
}

interface VodAiContentTabsProps {
  vod: InsightVodDocument;
  jobId?: string | null;
  defaultPosterUrl?: string | null;
  newsSaving: boolean;
  transcriptSaving: boolean;
  onSaveNews: (news: InsightVodNewsEntry[]) => Promise<void>;
  onSaveTranscript: (transcript: InsightVodTranscriptEntry[]) => Promise<void>;
}

export function VodAiContentTabs({
  vod,
  jobId,
  defaultPosterUrl,
  newsSaving,
  transcriptSaving,
  onSaveNews,
  onSaveTranscript,
}: VodAiContentTabsProps) {
  const tabItems = useMemo(
    () => [
      { id: "news", label: "News", children: "News" },
      { id: "transcript", label: "Transcript", children: "Transcript" },
    ],
    [],
  );

  return (
    <Tabs defaultSelectedKey="news" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <Tabs.List type="underline" orientation="horizontal" size="md" items={tabItems} />
      <Tabs.Panel id="news" className="min-h-0 flex-1 overflow-y-auto pt-1">
        <VodAiNewsTab
          vod={vod}
          jobId={jobId}
          defaultPosterUrl={defaultPosterUrl}
          saving={newsSaving}
          onSave={onSaveNews}
        />
      </Tabs.Panel>
      <Tabs.Panel id="transcript" className="min-h-0 flex-1 overflow-y-auto pt-1">
        <VodAiTranscriptTab vod={vod} saving={transcriptSaving} onSave={onSaveTranscript} />
      </Tabs.Panel>
    </Tabs>
  );
}
