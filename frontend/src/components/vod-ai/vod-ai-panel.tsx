import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  AiRun,
  AiRunOptions,
  AiRunServiceKey,
  AiServiceKey,
  CreditOrder,
  TenantCreditState,
} from "@/types/ai-credits";
import type { InsightVodContentItem, InsightVodDocument } from "@/types/insight-vod";
import { whisperLanguageLabel } from "@/types/editor-whisper-languages";
import { rebuildTranscriptPreviewText } from "@/utils/transcript-diarization";
import { cx } from "@/utils/cx";
import type { VodAiEditorKind } from "./vod-ai-editor-modal";
import { SparkleIcon } from "./vod-ai-icons";

const SERVICES: AiServiceKey[] = ["stt", "subtitles", "article", "dubbing"];
const ACTIVE_STATUSES = new Set(["queued", "processing", "uploading"]);

interface ResultAsset {
  language: string;
  label: string;
  url?: string;
  name?: string;
}

export interface VodAiPanelProps {
  vod: InsightVodDocument;
  runs: AiRun[];
  options: AiRunOptions | null;
  credits: TenantCreditState | null;
  orders: CreditOrder[];
  onRun: (service: AiRunServiceKey, languages: string[]) => Promise<boolean>;
  onOpenEditor: (kind: VodAiEditorKind, locale: string) => void;
  onBuyCredits: (neededCredits: number, serviceName: string) => void;
  onCancelOrder: (order: CreditOrder) => void;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h, m, r].map((n) => String(n).padStart(2, "0")).join(":");
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hasAssetType(item: InsightVodContentItem, re: RegExp): boolean {
  return (item.assetTypes ?? []).some((t) => re.test(String(t)));
}

function assetLanguage(item: InsightVodContentItem): string {
  return String(item.language || "").trim().toLowerCase();
}

export function VodAiPanel({
  vod,
  runs,
  options,
  credits,
  orders,
  onRun,
  onOpenEditor,
  onBuyCredits,
  onCancelOrder,
}: VodAiPanelProps) {
  const { t, i18n } = useTranslation("vodAi");
  const numLocale = i18n.language === "es" ? "es-AR" : "en-US";
  const fmt = (n: number) => Math.round(n).toLocaleString(numLocale);
  const money = (n: number) => "$" + n.toLocaleString(numLocale, { maximumFractionDigits: 2 });
  const langLabel = (code: string) => (code === "auto" ? t("box.autoDetect") : whisperLanguageLabel(code));

  const limiterActive = Boolean(credits?.limiterActive);
  const balance = limiterActive ? Number(credits?.totalRemaining ?? 0) : Number.POSITIVE_INFINITY;
  const durationSec = options?.durationSec ?? 0;

  const results = useMemo(() => {
    const transcript = (vod.transcript ?? []).filter((x) => x?.languageCode);
    const news = (vod.news ?? []).filter((x) => x?.languageCode);
    const content = Array.isArray(vod.content) ? vod.content : [];
    const subtitles: ResultAsset[] = content
      .filter((c) => hasAssetType(c, /subtitle/i) && c.downloadUrl)
      .map((c) => ({
        language: assetLanguage(c) || "und",
        label: c.languageName || whisperLanguageLabel(assetLanguage(c) || "und"),
        url: c.downloadUrl,
        name: c.name,
      }));
    const dubbing: ResultAsset[] = content
      .filter(
        (c) =>
          c.downloadUrl &&
          (hasAssetType(c, /audio|dub/i) || /^audio/i.test(String(c.type || c.medium || c.mime_type || ""))) &&
          !hasAssetType(c, /video|subtitle/i),
      )
      .map((c) => ({
        language: assetLanguage(c) || "und",
        label: c.languageName || whisperLanguageLabel(assetLanguage(c) || "und"),
        url: c.downloadUrl,
        name: c.name,
      }));
    return { transcript, news, subtitles, dubbing };
  }, [vod]);

  const doneLangs: Record<AiServiceKey, string[]> = useMemo(
    () => ({
      stt: results.transcript.map((x) => x.languageCode),
      article: results.news.map((x) => x.languageCode),
      subtitles: [...new Set(results.subtitles.map((x) => x.language))],
      dubbing: [...new Set(results.dubbing.map((x) => x.language))],
    }),
    [results],
  );

  const [addMode, setAddMode] = useState<Partial<Record<AiServiceKey, boolean>>>({});
  const [chosen, setChosen] = useState<Partial<Record<AiServiceKey, string[]>>>({});
  const [view, setView] = useState<Partial<Record<AiServiceKey, string>>>({});
  const [starting, setStarting] = useState<Partial<Record<AiServiceKey, boolean>>>({});

  const readyCount = SERVICES.filter((s) => doneLangs[s].length > 0).length;
  const usedCredits = runs.filter((r) => r.status === "completed").reduce((sum, r) => sum + (r.estimatedCredits || 0), 0);
  const pendingOrders = orders.filter((o) => o.status === "pending");

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("box.copied"));
    } catch {
      toast.error(t("box.copyFailed"));
    }
  };

  return (
    <section
      aria-label={t("panel.title")}
      className="flex min-w-0 flex-col rounded-[10px] border border-[#e6e9ee] bg-white text-sm text-[#2f3237]"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-[#e6e9ee] px-[18px] py-4">
        <h3 className="m-0 flex items-center gap-2 text-base font-semibold">
          <SparkleIcon className="size-[18px] text-[#2a9fd6]" />
          {t("panel.title")}
        </h3>
        <span className="text-[13px] text-[#6b7079]">
          {t("panel.billedPerMin", { duration: formatDuration(durationSec) })} ·{" "}
          {limiterActive ? (
            <Trans
              t={t}
              i18nKey="panel.balance"
              values={{ balance: fmt(balance) }}
              components={{ b: <b className={balance < 50 ? "text-[#b42328]" : "text-[#2f3237]"} /> }}
            />
          ) : (
            t("panel.balanceUnlimited")
          )}
        </span>
        <span className="ml-auto text-[13px] text-[#6b7079]">
          {t("panel.readySummary", { ready: readyCount, total: SERVICES.length, used: fmt(usedCredits) })}
        </span>
        {limiterActive ? (
          <button
            type="button"
            onClick={() => onBuyCredits(0, "")}
            className="text-[13px] font-semibold text-[#1d8fc4] hover:underline"
          >
            {t("panel.buyCredits")}
          </button>
        ) : null}
      </div>

      {pendingOrders.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-b border-[#e6e9ee] bg-[#eef6fc] px-[18px] py-2.5 text-[13px] text-[#1f4b6b]">
          {pendingOrders.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1">
                {o.kind === "enterprise"
                  ? t("panel.pendingEnterprise", { number: o.orderNumber })
                  : t("panel.pendingOrder", { number: o.orderNumber, credits: fmt(o.credits), price: money(o.priceUsd) })}
              </span>
              <button
                type="button"
                onClick={() => onCancelOrder(o)}
                className="font-semibold text-[#1f5ce0] hover:underline"
              >
                {t("panel.cancelOrder")}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 content-start gap-3 p-[18px] lg:grid-cols-2">
        {SERVICES.map((service) => {
          const supported = service === "stt" || service === "article" || service === "subtitles";
          const runService = service as AiRunServiceKey;
          const name = t(`services.${service}.name`);
          const done = doneLangs[service];
          const serviceRuns = runs.filter((r) => r.service === service);
          const activeRuns = serviceRuns.filter((r) => ACTIVE_STATUSES.has(r.status));
          const latestFinished = serviceRuns.find((r) => !ACTIVE_STATUSES.has(r.status));
          const lastError = latestFinished?.status === "failed" ? latestFinished.error || latestFinished.message || "" : "";
          const isProcessing = activeRuns.length > 0;
          const isAction = !isProcessing && (Boolean(addMode[service]) || done.length === 0);
          const isReady = !isProcessing && !isAction;

          const ratePerMin = options?.creditsPerMinute?.[service] ?? 0;
          const perLanguage = Math.ceil((ratePerMin * durationSec) / 60);
          const sel = chosen[service] ?? [];
          const actCost = perLanguage * sel.length;
          const doneCost = serviceRuns
            .filter((r) => r.status === "completed")
            .reduce((sum, r) => sum + (r.estimatedCredits || 0), 0);
          const low = limiterActive && sel.length > 0 && actCost > balance;
          const allowedLangs = supported ? options?.languages?.[runService] ?? [] : [];
          const languageOptions = allowedLangs.filter(
            (l) => !sel.includes(l) && !done.includes(l) && !(l === "auto" && done.length > 0),
          );
          const pendingLangs = [...new Set(activeRuns.flatMap((r) => r.languages))];
          const progress = activeRuns.length
            ? Math.round(activeRuns.reduce((sum, r) => sum + (r.progress || 0), 0) / activeRuns.length)
            : 0;
          const viewLang = view[service] && done.includes(view[service]!) ? view[service]! : done[0];

          const pill = isReady
            ? t("box.pill.ready")
            : isProcessing
              ? t("box.pill.processing")
              : !supported && done.length === 0
                ? t("box.pill.comingSoon")
                : done.length
                  ? t("box.pill.addLanguage")
                  : t("box.pill.notRun");
          const costLabel = isAction && supported ? t("box.credits", { value: fmt(actCost) }) : isReady && doneCost > 0 ? t("box.creditsUsed", { value: fmt(doneCost) }) : "";

          const setSel = (next: string[]) => setChosen((c) => ({ ...c, [service]: next }));
          const run = async () => {
            if (!supported || sel.length === 0 || low) return;
            setStarting((s) => ({ ...s, [service]: true }));
            const ok = await onRun(runService, sel);
            setStarting((s) => ({ ...s, [service]: false }));
            if (ok) {
              setSel([]);
              setAddMode((m) => ({ ...m, [service]: false }));
            }
          };

          return (
            <div key={service} className="flex min-h-[220px] min-w-0 flex-col rounded-lg border border-[#e6e9ee] bg-white">
              <div className="flex items-center gap-2.5 px-3.5 py-3">
                <span className="text-[15px] font-semibold">{name}</span>
                <span
                  className={cx(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    isReady ? "bg-[#ecfaf3] text-[#0b7a47]" : isProcessing ? "bg-[#eef4ff] text-[#1f5ce0]" : "bg-[#f0f2f5] text-[#555b63]",
                  )}
                >
                  {pill}
                </span>
                <span className="ml-auto font-bold">{costLabel}</span>
              </div>

              {isAction ? (
                <div className="flex flex-1 flex-col gap-2.5 px-3.5 pb-3.5">
                  <div className="text-[13px] text-[#6b7079]">
                    {t(`services.${service}.desc`)}
                    {supported && ratePerMin > 0 ? ` · ${t("box.perMin", { rate: ratePerMin })}` : ""}
                  </div>
                  {supported ? (
                    <>
                      <div role="group" aria-label={name} className="flex flex-wrap items-center gap-1.5">
                        {sel.map((l) => (
                          <span
                            key={l}
                            className="inline-flex h-[30px] items-center gap-1 rounded-full bg-[#dde6f7] pr-1 pl-2.5 text-[13px] font-medium text-[#1f5ce0]"
                          >
                            {langLabel(l)}
                            <button
                              type="button"
                              onClick={() => setSel(sel.filter((x) => x !== l))}
                              aria-label={t("box.removeLanguage", { language: langLabel(l) })}
                              className="size-[22px] rounded-full text-[15px] leading-none text-[#1f5ce0] hover:bg-white/60"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {languageOptions.length > 0 ? (
                          <select
                            aria-label={t("box.addLanguageTo", { service: name })}
                            value=""
                            onChange={(e) => {
                              const l = e.target.value;
                              if (l) setSel([...sel, l]);
                            }}
                            className="h-[30px] cursor-pointer rounded-full border border-dashed border-[#a9b4c6] bg-white px-2.5 text-[13px] text-[#1f5ce0]"
                          >
                            <option value="">{t("box.addLanguage")}</option>
                            {languageOptions.map((l) => (
                              <option key={l} value={l}>
                                {langLabel(l)}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                      {sel.length > 1 ? (
                        <div className="text-xs text-[#6b7079]">
                          {sel.map((l) => `${langLabel(l)} ${fmt(perLanguage)}`).join(" + ")}
                        </div>
                      ) : null}
                      {sel.length === 0 ? <div className="text-xs text-[#b42328]">{t("box.pickLanguage")}</div> : null}
                    </>
                  ) : (
                    <div className="text-xs text-[#6b7079]">{t("box.comingSoonHint")}</div>
                  )}
                  {lastError ? (
                    <div className="text-xs text-[#b42328]">{t("box.lastRunFailed", { error: lastError })}</div>
                  ) : null}
                  {done.length > 0 ? (
                    <div className="flex items-center gap-2.5 text-[13px] text-[#555b63]">
                      {t("box.alreadyDone", { list: done.map(langLabel).join(", ") })}
                      <button
                        type="button"
                        onClick={() => setAddMode((m) => ({ ...m, [service]: false }))}
                        className="ml-auto font-semibold text-[#1f5ce0] hover:underline"
                      >
                        {t("box.backToResult")}
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-center justify-end gap-2.5 border-t border-[#f0f2f5] pt-2.5">
                    {supported && limiterActive ? (
                      <span className="mr-auto text-[13px] text-[#6b7079]">
                        <Trans
                          t={t}
                          i18nKey="box.balanceAfter"
                          values={{ balance: fmt(balance - actCost) }}
                          components={{ b: <b className={actCost > balance ? "text-[#b42328]" : "text-[#2f3237]"} /> }}
                        />
                      </span>
                    ) : (
                      <span className="mr-auto" />
                    )}
                    {!supported ? (
                      <span className="inline-flex h-10 cursor-not-allowed items-center rounded-lg bg-[#c9d3de] px-4 font-semibold text-white">
                        {t("box.pill.comingSoon")}
                      </span>
                    ) : sel.length === 0 ? (
                      <span className="inline-flex h-10 items-center rounded-lg bg-[#c9d3de] px-4 font-semibold text-white">
                        {t("box.run")}
                      </span>
                    ) : low ? (
                      <>
                        <span
                          title={t("box.notEnoughCredits")}
                          className="inline-flex h-10 cursor-not-allowed items-center rounded-lg bg-[#c9d3de] px-4 font-semibold text-white"
                        >
                          {t("box.runCost", { value: fmt(actCost) })}
                        </span>
                        <button
                          type="button"
                          onClick={() => onBuyCredits(actCost, name)}
                          className="inline-flex h-10 items-center rounded-lg bg-[#f08a24] px-4 font-semibold text-white hover:brightness-95"
                        >
                          {t("panel.buyCredits")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(starting[service])}
                        onClick={() => void run()}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#1d8fc4] px-4 font-semibold text-white hover:bg-[#1f5ce0] disabled:opacity-60"
                      >
                        <SparkleIcon className="size-[15px]" strokeWidth={2} />
                        {t("box.runCost", { value: fmt(actCost) })}
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              {isProcessing ? (
                <div className="flex flex-1 flex-col justify-center gap-2.5 px-3.5 pb-4">
                  <div className="text-[13px] text-[#6b7079]">
                    {t("box.processingHint", { list: pendingLangs.map(langLabel).join(", ") })}
                  </div>
                  {done.length > 0 ? (
                    <div className="text-[13px] text-[#0b7a47]">
                      {t("box.stillAvailable", {
                        list: done.map(langLabel).join(", "),
                        pending: pendingLangs.map(langLabel).join(", "),
                      })}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-md bg-[#eef0f3]">
                      <div className="h-full bg-[#2a9fd6] transition-[width] duration-500" style={{ width: `${Math.max(3, progress)}%` }} />
                    </div>
                    <span className="text-[13px] text-[#6b7079]">{progress}%</span>
                  </div>
                </div>
              ) : null}

              {isReady && viewLang ? (
                <ReadyBody
                  service={service}
                  name={name}
                  done={done}
                  viewLang={viewLang}
                  langLabel={langLabel}
                  onPickLang={(l) => setView((v) => ({ ...v, [service]: l }))}
                  vod={vod}
                  subtitles={results.subtitles}
                  dubbing={results.dubbing}
                  onEdit={(kind) => onOpenEditor(kind, viewLang)}
                  onCopy={(text) => void copyText(text)}
                  onAddLanguage={supported ? () => setAddMode((m) => ({ ...m, [service]: true })) : undefined}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="rounded-b-[10px] border-t border-[#e6e9ee] bg-[#f7f8fa] px-[18px] py-3 text-[13px] text-[#6b7079]">
        {t("panel.footer")}
      </div>
    </section>
  );
}

interface ReadyBodyProps {
  service: AiServiceKey;
  name: string;
  done: string[];
  viewLang: string;
  langLabel: (code: string) => string;
  onPickLang: (lang: string) => void;
  vod: InsightVodDocument;
  subtitles: ResultAsset[];
  dubbing: ResultAsset[];
  onEdit: (kind: VodAiEditorKind) => void;
  onCopy: (text: string) => void;
  onAddLanguage?: () => void;
}

const actionBtn =
  "inline-flex h-[38px] items-center rounded-md border border-[#d5d9e0] bg-white px-3 font-medium text-[#2f3237] no-underline hover:border-[#1f5ce0] hover:bg-[#1f5ce0] hover:text-white";

function ReadyBody({
  service,
  name,
  done,
  viewLang,
  langLabel,
  onPickLang,
  vod,
  subtitles,
  dubbing,
  onEdit,
  onCopy,
  onAddLanguage,
}: ReadyBodyProps) {
  const { t } = useTranslation("vodAi");
  const slug = (vod.title || vod.guid || "vod").replace(/[^\w-]+/g, "_").slice(0, 60);

  const transcriptEntry = service === "stt" ? (vod.transcript ?? []).find((x) => x.languageCode === viewLang) : undefined;
  const newsEntry = service === "article" ? (vod.news ?? []).find((x) => x.languageCode === viewLang) : undefined;
  const subtitleAsset = service === "subtitles" ? subtitles.find((x) => x.language === viewLang) : undefined;
  const dubbingAsset = service === "dubbing" ? dubbing.find((x) => x.language === viewLang) : undefined;

  const transcriptText = useMemo(() => {
    if (!transcriptEntry) return "";
    const di = transcriptEntry.diarization;
    if (di && Array.isArray(di.segments) && di.segments.length > 0) return rebuildTranscriptPreviewText(di);
    return transcriptEntry.text?.trim() ?? "";
  }, [transcriptEntry]);

  const articleText = useMemo(() => {
    if (!newsEntry) return "";
    return [newsEntry.title, newsEntry.description, stripHtml(newsEntry.htmlBody || newsEntry.text || "")]
      .filter((x) => x && String(x).trim())
      .join("\n\n");
  }, [newsEntry]);

  const [vttText, setVttText] = useState<string | null>(null);
  const [vttLoading, setVttLoading] = useState(false);
  useEffect(() => {
    if (!subtitleAsset?.url) {
      setVttText(null);
      return;
    }
    let cancelled = false;
    setVttLoading(true);
    fetch(subtitleAsset.url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        if (!cancelled) setVttText(text.replace(/^WEBVTT[^\n]*\n+/, "").slice(0, 4000));
      })
      .catch(() => {
        if (!cancelled) setVttText(null);
      })
      .finally(() => {
        if (!cancelled) setVttLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subtitleAsset?.url]);

  const preview =
    service === "stt"
      ? transcriptText
      : service === "article"
        ? articleText
        : service === "subtitles"
          ? vttLoading
            ? t("box.loadingPreview")
            : vttText ?? t("box.noPreview")
          : dubbingAsset
            ? `${dubbingAsset.name || name} · ${dubbingAsset.label}`
            : "";
  const rtl = viewLang === "he" || viewLang === "ar";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label={t("box.languageTabs", { service: name })} className="flex flex-wrap gap-1.5 px-3.5 pb-2.5">
        {done.map((l) => {
          const on = l === viewLang;
          return (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onPickLang(l)}
              className={cx(
                "h-7 rounded-full border px-2.5 text-[13px] font-semibold",
                on ? "border-[#1f5ce0] bg-[#1f5ce0] text-white" : "border-[#d5d9e0] bg-white text-[#2f3237] hover:text-[#0a3fb8]",
              )}
            >
              {langLabel(l)}
            </button>
          );
        })}
      </div>
      {service === "dubbing" && dubbingAsset?.url ? (
        <div className="mx-3.5 rounded-md border border-[#eef0f3] bg-[#fafbfc] px-3.5 py-3">
          <div className="mb-2 text-[13.5px] text-[#444]">{preview}</div>
          <audio controls preload="none" src={dubbingAsset.url} className="w-full" />
        </div>
      ) : (
        <div
          dir={rtl ? "rtl" : "ltr"}
          lang={viewLang}
          className="mx-3.5 max-h-[220px] min-h-[72px] flex-1 overflow-auto rounded-md border border-[#eef0f3] bg-[#fafbfc] px-3.5 py-3 text-[13.5px] leading-relaxed whitespace-pre-line text-[#444]"
        >
          {preview || t("box.noResult")}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3 pb-3.5">
        {service === "stt" ? (
          <>
            <button type="button" className={actionBtn} onClick={() => onEdit("stt")}>
              {t("box.actions.editView")}
            </button>
            <button type="button" className={actionBtn} onClick={() => onCopy(transcriptText)}>
              {t("box.actions.copy")}
            </button>
            <button
              type="button"
              className={actionBtn}
              onClick={() => downloadText(`${slug}_transcript_${viewLang}.txt`, transcriptText)}
            >
              {t("box.actions.download")}
            </button>
          </>
        ) : null}
        {service === "article" ? (
          <>
            <button type="button" className={actionBtn} onClick={() => onEdit("article")}>
              {t("box.actions.editView")}
            </button>
            <button type="button" className={actionBtn} onClick={() => onCopy(JSON.stringify(newsEntry ?? {}, null, 2))}>
              {t("box.actions.copyJson")}
            </button>
            <button
              type="button"
              className={actionBtn}
              onClick={() =>
                downloadText(
                  `${slug}_article_${viewLang}.html`,
                  `<!DOCTYPE html><html lang="${viewLang}"${rtl ? ' dir="rtl"' : ""}><head><meta charset="utf-8"><title>${escapeHtml(newsEntry?.title ?? "")}</title></head><body><h1>${escapeHtml(newsEntry?.title ?? "")}</h1><p><em>${escapeHtml(newsEntry?.description ?? "")}</em></p>${newsEntry?.htmlBody ?? ""}</body></html>`,
                  "text/html",
                )
              }
            >
              {t("box.actions.download")}
            </button>
          </>
        ) : null}
        {service === "subtitles" && subtitleAsset?.url ? (
          <a className={actionBtn} href={subtitleAsset.url} target="_blank" rel="noreferrer" download>
            {t("box.actions.downloadVtt")}
          </a>
        ) : null}
        {service === "dubbing" && dubbingAsset?.url ? (
          <a className={actionBtn} href={dubbingAsset.url} target="_blank" rel="noreferrer" download>
            {t("box.actions.download")}
          </a>
        ) : null}
        {onAddLanguage ? (
          <button type="button" onClick={onAddLanguage} className="ml-auto text-[13px] font-semibold text-[#1d8fc4] hover:underline">
            {t("box.addAnotherLanguage")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
