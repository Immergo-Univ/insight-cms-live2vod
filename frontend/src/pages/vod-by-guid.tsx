import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { toast } from "sonner";
import { BuyCreditsModal } from "@/components/vod-ai/vod-ai-buy-credits-modal";
import { VodAiEditorModal, type VodAiEditorKind } from "@/components/vod-ai/vod-ai-editor-modal";
import { VodAiPanel } from "@/components/vod-ai/vod-ai-panel";
import vodAiI18n from "@/i18n/vod-ai-i18n";
import {
  cancelCreditOrder,
  fetchAiCredits,
  fetchVodAiRuns,
  readApiError,
  startVodAiRun,
} from "@/services/ai-credits.service";
import { httpClient } from "@/services/http-client";
import { fetchVodAiByGuid, patchVodAiByGuid } from "@/services/vod.service";
import type { AiCreditsResponse, AiRun, AiRunOptions, AiRunServiceKey, CreditOrder } from "@/types/ai-credits";
import type {
  InsightVodDocument,
  InsightVodNewsEntry,
  InsightVodTranscriptEntry,
  VodAiJobSummary,
} from "@/types/insight-vod";
import { resolveInsightVodPosterUrl } from "@/types/insight-vod";

const ACTIVE_STATUSES = new Set(["queued", "processing", "uploading"]);
const POLL_MS = 4000;
/** Keep polling a completed run until the backend marks it synced into Insight (or this window passes). */
const SYNC_WAIT_MS = 2 * 60 * 1000;

function needsPolling(run: AiRun): boolean {
  if (ACTIVE_STATUSES.has(run.status)) return true;
  if (run.status === "completed" && !run.synced) {
    return Date.now() - new Date(run.updatedAt).getTime() < SYNC_WAIT_MS;
  }
  return false;
}

function VodByGuidContent() {
  const { t } = useTranslation("vodAi");
  const { vod_guid: vodGuidParam } = useParams<{ vod_guid: string }>();
  const vodGuid = String(vodGuidParam || "").trim();
  const tenantId = httpClient.getTenantId();

  const [vod, setVod] = useState<InsightVodDocument | null>(null);
  const [job, setJob] = useState<VodAiJobSummary | null>(null);
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [runOptions, setRunOptions] = useState<AiRunOptions | null>(null);
  const [creditsData, setCreditsData] = useState<AiCreditsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ kind: VodAiEditorKind; locale: string } | null>(null);
  const [buy, setBuy] = useState<{ needed: number; serviceName: string } | null>(null);

  /** Last seen status per run id, to detect transitions while polling. */
  const runStateRef = useRef<Map<string, string>>(new Map());

  const errorText = useCallback(
    (e: unknown) => {
      const { code, message } = readApiError(e);
      if (code && t(`errors.${code}`, { defaultValue: "" })) return t(`errors.${code}`);
      return message || t("errors.generic");
    },
    [t],
  );

  const loadCredits = useCallback(async () => {
    try {
      setCreditsData(await fetchAiCredits());
    } catch {
      setCreditsData(null);
    }
  }, []);

  const rememberRuns = useCallback((list: AiRun[]) => {
    const map = new Map<string, string>();
    for (const r of list) map.set(r.id, `${r.status}:${r.synced ? 1 : 0}`);
    runStateRef.current = map;
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const data = await fetchVodAiRuns(vodGuid);
      setRunOptions(data.options);
      return data.runs;
    } catch {
      return null;
    }
  }, [vodGuid]);

  const load = useCallback(async () => {
    if (!vodGuid) {
      setError(t("page.missingGuid"));
      setLoading(false);
      return;
    }
    if (!tenantId) {
      setError(t("page.missingTenant"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [data, runList] = await Promise.all([fetchVodAiByGuid(vodGuid), loadRuns(), loadCredits()]);
      setVod(data.vod);
      setJob(data.job);
      if (runList) {
        setRuns(runList);
        rememberRuns(runList);
      }
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      setError(ax.response?.data?.error || (e instanceof Error ? e.message : t("page.loadFailed")));
      setVod(null);
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [vodGuid, tenantId, t, loadRuns, loadCredits, rememberRuns]);

  useEffect(() => {
    void load();
  }, [load]);

  const shouldPoll = useMemo(() => runs.some(needsPolling), [runs]);

  useEffect(() => {
    if (!shouldPoll || !vodGuid) return;
    const timer = window.setInterval(async () => {
      const next = await loadRuns();
      if (!next) return;
      const prev = runStateRef.current;
      const finished = next.filter((r) => {
        const before = prev.get(r.id);
        const now = `${r.status}:${r.synced ? 1 : 0}`;
        return before !== undefined && before !== now && !ACTIVE_STATUSES.has(r.status);
      });
      setRuns(next);
      rememberRuns(next);
      if (finished.length === 0) return;
      for (const r of finished) {
        const service = t(`services.${r.service}.name`);
        if (r.status === "completed" && r.synced) toast.success(t("box.runCompleted", { service }));
        if (r.status === "failed") toast.error(t("box.lastRunFailed", { error: r.error || r.message || "" }));
      }
      try {
        const data = await fetchVodAiByGuid(vodGuid);
        setVod(data.vod);
        setJob(data.job);
      } catch {
        // keep the current VOD; next poll retries
      }
      void loadCredits();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [shouldPoll, vodGuid, loadRuns, loadCredits, rememberRuns, t]);

  const posterUrl = useMemo(() => (vod ? resolveInsightVodPosterUrl(vod) : null), [vod]);

  const handleRun = useCallback(
    async (service: AiRunServiceKey, languages: string[]) => {
      const serviceName = t(`services.${service}.name`);
      try {
        const res = await startVodAiRun(vodGuid, service, languages);
        setRuns(res.runs);
        rememberRuns(res.runs);
        toast.success(t("box.runStarted", { service: serviceName }));
        void loadCredits();
        return true;
      } catch (e) {
        const { code } = readApiError(e);
        toast.error(`${t("box.runFailed", { service: serviceName })}: ${errorText(e)}`);
        if (code === "NO_CREDITS") void loadCredits();
        return false;
      }
    },
    [vodGuid, t, errorText, loadCredits, rememberRuns],
  );

  const saveAi = useCallback(
    async (body: { news?: InsightVodNewsEntry[]; transcript?: InsightVodTranscriptEntry[] }, okKey: string) => {
      if (!vodGuid) return;
      setSaving(true);
      try {
        const data = await patchVodAiByGuid(vodGuid, body);
        setVod(data.vod);
        setJob(data.job);
        toast.success(t(okKey));
      } catch (e) {
        const msg = errorText(e) || t("editor.saveFailed");
        toast.error(msg);
        throw e instanceof Error ? e : new Error(msg);
      } finally {
        setSaving(false);
      }
    },
    [vodGuid, t, errorText],
  );

  const handleSaveNews = useCallback((news: InsightVodNewsEntry[]) => saveAi({ news }, "editor.newsSaved"), [saveAi]);
  const handleSaveTranscript = useCallback(
    (transcript: InsightVodTranscriptEntry[]) => saveAi({ transcript }, "editor.transcriptSaved"),
    [saveAi],
  );

  const handleCancelOrder = useCallback(
    async (order: CreditOrder) => {
      try {
        await cancelCreditOrder(order.id);
        toast.success(t("panel.orderCancelled"));
        void loadCredits();
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [t, errorText, loadCredits],
  );

  const credits = creditsData?.credits ?? null;
  const balance = credits?.limiterActive ? Number(credits.totalRemaining ?? 0) : 0;

  return (
    <div className="flex h-full flex-col bg-white">
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6">
        {loading && !vod ? (
          <div className="flex flex-1 items-center justify-center text-sm text-tertiary">{t("page.loading")}</div>
        ) : null}

        {!loading && error && !vod ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-sm font-medium text-error-primary">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-secondary bg-secondary px-3 py-1.5 text-xs font-medium text-primary hover:bg-tertiary"
            >
              {t("page.retry")}
            </button>
          </div>
        ) : null}

        {vod ? (
          <>
            <VodAiPanel
              vod={vod}
              runs={runs}
              options={runOptions}
              credits={credits}
              orders={creditsData?.orders ?? []}
              onRun={handleRun}
              onOpenEditor={(kind, locale) => setEditor({ kind, locale })}
              onBuyCredits={(needed, serviceName) => setBuy({ needed, serviceName })}
              onCancelOrder={(o) => void handleCancelOrder(o)}
            />
            <VodAiEditorModal
              kind={editor?.kind ?? null}
              initialLocale={editor?.locale}
              vod={vod}
              jobId={job?.id}
              defaultPosterUrl={posterUrl}
              saving={saving}
              onClose={() => setEditor(null)}
              onSaveNews={handleSaveNews}
              onSaveTranscript={handleSaveTranscript}
            />
            <BuyCreditsModal
              isOpen={buy !== null}
              onClose={() => setBuy(null)}
              catalog={creditsData?.catalog ?? null}
              balance={balance}
              vodGuid={vodGuid}
              neededCredits={buy?.needed || undefined}
              neededFor={buy?.serviceName}
              onOrderCreated={() => void loadCredits()}
            />
          </>
        ) : null}
      </main>
    </div>
  );
}

export function VodByGuidPage() {
  return (
    <I18nextProvider i18n={vodAiI18n}>
      <VodByGuidContent />
    </I18nextProvider>
  );
}
