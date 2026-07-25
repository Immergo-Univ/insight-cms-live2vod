import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Check, Link01 } from "@untitledui/icons";
import { httpClient } from "@/services/http-client";
import type { TranscriptNewsLocaleBlock } from "@/types/vod-job";

function exec(cmd: string, value?: string) {
  try {
    document.execCommand(cmd, false, value);
  } catch {
    /* ignore */
  }
}

interface TranscriptNewsLocalePanelProps {
  locale: string;
  /** When set, shows the public share URL for this job/locale. */
  jobId?: string;
  /** Bumps when job is refetched so editor body can sync from server. */
  jobContentStamp?: string;
  block: TranscriptNewsLocaleBlock;
  onChange: (next: TranscriptNewsLocaleBlock) => void;
  defaultPosterUrl?: string;
}

export function TranscriptNewsLocalePanel({
  locale,
  jobId,
  jobContentStamp,
  block,
  onChange,
  defaultPosterUrl,
}: TranscriptNewsLocalePanelProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const tenantId = httpClient.getTenantId().trim();
  const publicUrl =
    typeof window !== "undefined" && tenantId && jobId
      ? `${window.location.origin}/api/public/transcript-news/${encodeURIComponent(tenantId)}/${encodeURIComponent(jobId)}?lang=${locale}`
      : "";

  const posterSrc = (block.posterDataUrl || block.posterUrl || defaultPosterUrl || "").trim();

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = block.htmlBody || "<p></p>";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-hydrate editor when tab/job snapshot changes, not on every keystroke
  }, [locale, jobId, jobContentStamp]);

  const syncHtmlFromDom = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    onChange({ ...block, htmlBody: el.innerHTML });
  }, [block, onChange]);

  const [linkCopied, setLinkCopied] = useState(false);

  /** Copy with a clipboard-API attempt and an execCommand fallback for non-secure contexts. */
  const copyText = useCallback(async (text: string): Promise<boolean> => {
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall back to execCommand below */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const copyPublicLink = useCallback(async () => {
    const ok = await copyText(publicUrl);
    if (ok) {
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    }
  }, [copyText, publicUrl]);

  return (
    <div className="flex min-w-0 flex-col gap-4" lang={locale} dir={locale === "he" ? "rtl" : "ltr"}>
      <label className="flex min-w-0 flex-col gap-0.5 text-xs font-medium text-secondary">
        Title
        <input
          type="text"
          data-no-row-select
          className="rounded border border-secondary bg-primary px-2 py-1.5 text-sm text-primary outline-none"
          value={block.title}
          onChange={(e) => onChange({ ...block, title: e.target.value })}
        />
      </label>

      <label className="flex min-w-0 flex-col gap-0.5 text-xs font-medium text-secondary">
        Description
        <textarea
          data-no-row-select
          rows={3}
          className="min-h-[4.5rem] resize-y rounded border border-secondary bg-primary px-2 py-1.5 text-sm text-primary outline-none"
          value={block.description ?? ""}
          onChange={(e) => onChange({ ...block, description: e.target.value })}
          placeholder="Short summary for sharing and the public page lead."
        />
      </label>

      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-0.5 text-xs font-medium text-secondary">
          Date
          <input
            type="date"
            data-no-row-select
            className="rounded border border-secondary bg-primary px-2 py-1.5 text-sm text-primary outline-none"
            value={block.date}
            onChange={(e) => onChange({ ...block, date: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-xs font-medium text-secondary">
          Time
          <input
            type="time"
            data-no-row-select
            className="rounded border border-secondary bg-primary px-2 py-1.5 text-sm text-primary outline-none"
            value={block.time}
            onChange={(e) => onChange({ ...block, time: e.target.value })}
          />
        </label>
      </div>

      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-secondary bg-secondary/30 p-3">
        <span className="text-xs font-semibold text-secondary">Poster and caption</span>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex shrink-0 flex-col gap-1">
            <div className="relative aspect-video w-full max-w-[16rem] overflow-hidden rounded-lg border border-secondary bg-secondary sm:w-56">
              {posterSrc ? (
                <img src={posterSrc} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full min-h-[6rem] items-center justify-center text-[10px] text-tertiary">
                  No poster
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {defaultPosterUrl ? (
                <button
                  type="button"
                  data-no-row-select
                  className="rounded border border-secondary bg-secondary px-2 py-1 text-[11px] font-medium text-primary hover:bg-tertiary"
                  onClick={() => onChange({ ...block, posterUrl: defaultPosterUrl, posterDataUrl: null })}
                >
                  Use clip thumbnail
                </button>
              ) : null}
              <label className="cursor-pointer rounded border border-secondary bg-secondary px-2 py-1 text-[11px] font-medium text-primary hover:bg-tertiary">
                Upload image
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = () => {
                      const data = typeof r.result === "string" ? r.result : "";
                      onChange({ ...block, posterDataUrl: data, posterUrl: null });
                    };
                    r.readAsDataURL(f);
                  }}
                />
              </label>
            </div>
          </div>
          <label className="min-w-0 flex-1 flex flex-col gap-0.5 text-xs font-medium text-secondary">
            Poster caption
            <textarea
              data-no-row-select
              rows={4}
              className="min-h-[5rem] resize-y rounded border border-secondary bg-primary px-2 py-1.5 text-sm text-primary outline-none"
              value={block.posterCaption ?? ""}
              onChange={(e) => onChange({ ...block, posterCaption: e.target.value })}
              placeholder="Line below the image (lead, credit, or context)."
            />
          </label>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-secondary">Body</span>
        <div className="mt-1 flex flex-wrap gap-1 border-b border-secondary pb-1">
            <button
              type="button"
              data-no-row-select
              className="rounded border border-secondary px-2 py-0.5 text-xs font-semibold"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editorRef.current?.focus();
                exec("bold");
                syncHtmlFromDom();
              }}
            >
              B
            </button>
            <button
              type="button"
              data-no-row-select
              className="rounded border border-secondary px-2 py-0.5 text-xs italic"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editorRef.current?.focus();
                exec("italic");
                syncHtmlFromDom();
              }}
            >
              I
            </button>
            <button
              type="button"
              data-no-row-select
              className="rounded border border-secondary px-2 py-0.5 text-xs underline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editorRef.current?.focus();
                exec("underline");
                syncHtmlFromDom();
              }}
            >
              U
            </button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          data-no-row-select
          className="prose prose-sm mt-1 max-w-none min-h-[140px] rounded border border-secondary bg-primary px-2 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-brand-solid/30"
          onBlur={() => syncHtmlFromDom()}
          onInput={() => syncHtmlFromDom()}
        />
      </div>

      {publicUrl ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-secondary bg-secondary/40 px-2 py-2">
          <p className="text-xs font-medium text-secondary">Share</p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-no-row-select
              title={publicUrl}
              className="min-w-0 flex-1 truncate rounded bg-primary px-1.5 py-1 font-mono text-[10px] text-brand-secondary underline hover:text-brand-primary"
            >
              {publicUrl}
            </a>
            <button
              type="button"
              data-no-row-select
              title="Copy public link"
              aria-label="Copy public link"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary hover:bg-secondary"
              onClick={() => void copyPublicLink()}
            >
              {linkCopied ? (
                <Check className="size-4 text-fg-success-primary" aria-hidden />
              ) : (
                <Link01 className="size-4" aria-hidden />
              )}
            </button>
          </div>
          <p className="text-[10px] text-tertiary">
            Public page includes title, description, poster with caption, and body. Open Graph uses description and
            og:image when poster URL is http(s).
          </p>
        </div>
      ) : null}
    </div>
  );
}
