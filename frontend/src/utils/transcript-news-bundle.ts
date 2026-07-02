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
 *
 * Locale-agnostic: preserves EVERY locale present in `job.transcriptNewsBundle` (the encoder
 * output, e.g. "ar"), not just the legacy en/es/he flat fields. Optionally ensures a block
 * exists for each requested locale (tenant `availableLanguages`) so all news tabs render.
 */
export function deriveTranscriptNewsBundleFromJob(
  job: VodJobRecord,
  opts: { defaultPosterUrl?: string; locales?: string[] },
): TranscriptNewsBundle {
  const updatedAt = job.updatedAt || job.createdAt;
  const posterUrl = opts.defaultPosterUrl?.trim() || undefined;

  // Legacy flat fields only ever existed for en/es/he.
  const legacyPlain: Record<string, string> = {
    en: job.transcriptNewsEn?.trim() ?? "",
    es: job.transcriptNewsEs?.trim() ?? "",
    he: job.transcriptNewsHe?.trim() ?? "",
  };

  const existing = job.transcriptNewsBundle;
  const existingObj: Record<string, unknown> =
    existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};

  // Union of locales to render: requested (tenant pool) + present in the encoder bundle + legacy.
  const codes = new Set<string>();
  for (const c of opts.locales ?? []) {
    const code = String(c || "").trim().toLowerCase();
    if (code) codes.add(code);
  }
  for (const key of Object.keys(existingObj)) {
    if (key === "version") continue;
    codes.add(key.toLowerCase());
  }
  for (const [code, plain] of Object.entries(legacyPlain)) {
    if (plain) codes.add(code);
  }
  if (codes.size === 0) {
    codes.add("en");
    codes.add("es");
    codes.add("he");
  }

  const out: TranscriptNewsBundle = { version: 1 };
  for (const code of codes) {
    const fallback = blockFromPlain(legacyPlain[code] ?? "", { posterUrl, updatedAt });
    const ex = existingObj[code];
    out[code] =
      ex && typeof ex === "object"
        ? normalizeLocaleBlock({
            ...fallback,
            ...(ex as Partial<TranscriptNewsLocaleBlock>),
            posterUrl:
              (ex as TranscriptNewsLocaleBlock).posterUrl ?? fallback.posterUrl ?? null,
            posterDataUrl:
              (ex as TranscriptNewsLocaleBlock).posterDataUrl ?? fallback.posterDataUrl ?? null,
          })
        : fallback;
  }
  return out;
}
