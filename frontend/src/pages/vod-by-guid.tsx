import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { VodAiContentTabs } from "@/components/vod-ai/vod-ai-content-tabs";
import { fetchVodAiByGuid, patchVodAiByGuid } from "@/services/vod.service";
import type {
  InsightVodDocument,
  InsightVodNewsEntry,
  InsightVodTranscriptEntry,
  VodAiJobSummary,
} from "@/types/insight-vod";
import { resolveInsightVodPosterUrl } from "@/types/insight-vod";
import { httpClient } from "@/services/http-client";
import { toast } from "sonner";

export function VodByGuidPage() {
  const { vod_guid: vodGuidParam } = useParams<{ vod_guid: string }>();
  const vodGuid = String(vodGuidParam || "").trim();

  const [vod, setVod] = useState<InsightVodDocument | null>(null);
  const [job, setJob] = useState<VodAiJobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newsSaving, setNewsSaving] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);

  const tenantId = httpClient.getTenantId();

  const load = useCallback(async () => {
    if (!vodGuid) {
      setError("Missing VOD guid in the URL");
      setLoading(false);
      return;
    }
    if (!tenantId) {
      setError("Missing tenantId (query or embed context)");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchVodAiByGuid(vodGuid);
      setVod(data.vod);
      setJob(data.job);
    } catch (e) {
      const ax = e as { response?: { status?: number; data?: { error?: string } } };
      const msg =
        ax.response?.data?.error ||
        (e instanceof Error ? e.message : "Failed to load VOD");
      setError(msg);
      setVod(null);
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [vodGuid, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const posterUrl = useMemo(() => (vod ? resolveInsightVodPosterUrl(vod) : null), [vod]);

  const handleSaveNews = useCallback(
    async (news: InsightVodNewsEntry[]) => {
      if (!vodGuid) return;
      setNewsSaving(true);
      try {
        const data = await patchVodAiByGuid(vodGuid, { news });
        setVod(data.vod);
        setJob(data.job);
        toast.success("News saved");
      } catch (e) {
        const ax = e as { response?: { data?: { error?: string; detail?: string } } };
        const msg = ax.response?.data?.error || (e instanceof Error ? e.message : "Save failed");
        toast.error(msg);
        throw e instanceof Error ? e : new Error(msg);
      } finally {
        setNewsSaving(false);
      }
    },
    [vodGuid],
  );

  const handleSaveTranscript = useCallback(
    async (transcript: InsightVodTranscriptEntry[]) => {
      if (!vodGuid) return;
      setTranscriptSaving(true);
      try {
        const data = await patchVodAiByGuid(vodGuid, { transcript });
        setVod(data.vod);
        setJob(data.job);
        toast.success("Transcript saved");
      } catch (e) {
        const ax = e as { response?: { data?: { error?: string; detail?: string } } };
        const msg = ax.response?.data?.error || (e instanceof Error ? e.message : "Save failed");
        toast.error(msg);
        throw e instanceof Error ? e : new Error(msg);
      } finally {
        setTranscriptSaving(false);
      }
    },
    [vodGuid],
  );

  return (
    <div className="flex h-full flex-col bg-primary">
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
        {loading && !vod ? (
          <div className="flex flex-1 items-center justify-center text-sm text-tertiary">Loading VOD…</div>
        ) : null}

        {!loading && error && !vod ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-sm font-medium text-error-primary">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-secondary bg-secondary px-3 py-1.5 text-xs font-medium text-primary hover:bg-tertiary"
            >
              Retry
            </button>
          </div>
        ) : null}

        {vod ? (
          <section className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-secondary bg-primary px-3 py-3 sm:px-4">
            <VodAiContentTabs
              vod={vod}
              jobId={job?.id}
              defaultPosterUrl={posterUrl}
              newsSaving={newsSaving}
              transcriptSaving={transcriptSaving}
              onSaveNews={handleSaveNews}
              onSaveTranscript={handleSaveTranscript}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
