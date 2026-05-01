import type { TranscriptNewsBundle, TranscriptNewsLocaleBlock, VodJobRecord } from "@/types/vod-job";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plainToHtmlBody(plain: string): string {
  const t = plain.trim();
  if (!t) return "<p></p>";
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return `<p>${esc(t)}</p>`;
  return paras.map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`).join("");
}

function firstLineRest(plain: string): { title: string; body: string } {
  const t = plain.trim();
  if (!t) return { title: "News", body: "" };
  const nl = t.indexOf("\n");
  if (nl === -1) return { title: t.slice(0, 120) || "News", body: t };
  const title = t.slice(0, nl).trim().slice(0, 200) || "News";
  const body = t.slice(nl + 1).trim();
  return { title, body: body || t };
}

function isoDateParts(iso?: string): { date: string; time: string } {
  if (!iso) {
    const d = new Date();
    return {
      date: d.toISOString().slice(0, 10),
      time: d.toTimeString().slice(0, 5),
    };
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return isoDateParts(undefined);
  }
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toTimeString().slice(0, 5),
  };
}

function normalizeLocaleBlock(
  b: Partial<TranscriptNewsLocaleBlock> & { subtitle?: string },
): TranscriptNewsLocaleBlock {
  const desc = String(b.description ?? "").trim() || String(b.subtitle ?? "").trim();
  const htmlBody =
    typeof b.htmlBody === "string" && b.htmlBody.trim() ? b.htmlBody : "<p></p>";
  return {
    title: String(b.title ?? "").trim() || "News",
    description: desc,
    posterCaption: String(b.posterCaption ?? "").trim(),
    date: String(b.date ?? "").trim(),
    time: String(b.time ?? "").trim(),
    posterUrl: b.posterUrl ?? null,
    posterDataUrl: b.posterDataUrl ?? null,
    htmlBody,
  };
}

function blockFromPlain(
  plain: string,
  opts: { posterUrl?: string; updatedAt?: string },
): TranscriptNewsLocaleBlock {
  const { title, body } = firstLineRest(plain);
  const { date, time } = isoDateParts(opts.updatedAt);
  return {
    title,
    description: "",
    posterCaption: "",
    date,
    time,
    posterUrl: opts.posterUrl,
    posterDataUrl: null,
    htmlBody: plainToHtmlBody(body || plain),
  };
}

/**
 * Build or hydrate rich news bundle from job fields (client-side defaults).
 */
export function deriveTranscriptNewsBundleFromJob(
  job: VodJobRecord,
  opts: { defaultPosterUrl?: string },
): TranscriptNewsBundle {
  const updatedAt = job.updatedAt || job.createdAt;
  const posterUrl = opts.defaultPosterUrl?.trim() || undefined;
  const base: TranscriptNewsBundle = {
    version: 1,
    en: blockFromPlain(job.transcriptNewsEn?.trim() ?? "", { posterUrl, updatedAt }),
    es: blockFromPlain(job.transcriptNewsEs?.trim() ?? "", { posterUrl, updatedAt }),
    he: blockFromPlain(job.transcriptNewsHe?.trim() ?? "", { posterUrl, updatedAt }),
  };
  const existing = job.transcriptNewsBundle;
  if (!existing || typeof existing !== "object") return base;
  const mergeLocale = (
    loc: "en" | "es" | "he",
    fallback: TranscriptNewsLocaleBlock,
  ): TranscriptNewsLocaleBlock => {
    const ex = existing[loc];
    if (!ex || typeof ex !== "object") return fallback;
    return normalizeLocaleBlock({
      ...fallback,
      ...ex,
      posterUrl: ex.posterUrl ?? fallback.posterUrl ?? null,
      posterDataUrl: ex.posterDataUrl ?? fallback.posterDataUrl ?? null,
    });
  };
  return {
    version: 1,
    en: mergeLocale("en", base.en),
    es: mergeLocale("es", base.es),
    he: mergeLocale("he", base.he),
  };
}
