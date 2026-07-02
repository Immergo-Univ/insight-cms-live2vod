import { Router } from "express";
import { config } from "../config.js";
import { resolveTenant } from "../services/auth.service.js";
import { getJob } from "../services/vod-jobs.store.js";
import { decodeTenantParam } from "../middleware/decode-tenant.middleware.js";
import { getSequelize } from "../db/sequelize.js";
import { normalizeAvailableLanguages } from "../utils/tenant-languages.js";

/**
 * Clip thumbnail (genThumbTime) from the stored editor spec — universal poster fallback for
 * older jobs that predate the persisted __vodPosterUrl. No insight-api call required.
 * @param {any} spec
 * @returns {string}
 */
function clipThumbnailUrlFromSpec(spec) {
  const base = (config.thumbnailApiBase || "").trim();
  const clipUrl = typeof spec?.clipUrl === "string" ? spec.clipUrl.trim() : "";
  const channelId = typeof spec?.channelId === "string" ? spec.channelId.trim() : "";
  if (!base || !clipUrl || !channelId) return "";
  const startTime =
    Array.isArray(spec?.clips) && spec.clips[0] ? Number(spec.clips[0].startTime) || 0 : 0;
  const params = new URLSearchParams();
  params.set("url", clipUrl);
  params.set("time", String(startTime));
  params.set("channelId", channelId);
  return `${base}?${params.toString()}`;
}

export const publicTranscriptNewsRouter = Router();

// Accept either an encrypted or plaintext tenant in the path segment.
publicTranscriptNewsRouter.param("tenantId", decodeTenantParam);

/**
 * @param {string} s
 */
function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {string} s
 */
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Strip scripts from user HTML for public render (best-effort).
 * @param {string} html
 */
function stripScripts(html) {
  return String(html ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

/**
 * @param {string} html
 */
function stripTagsPlain(html) {
  return String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * GET /api/public/transcript-news/:tenantId/:jobId?lang=en|es|he
 * Server-rendered HTML with Open Graph meta for link previews.
 */
publicTranscriptNewsRouter.get("/transcript-news/:tenantId/:jobId", async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const lang = String(req.query.lang || "en").trim().toLowerCase();
    if (!tenantId || !jobId) {
      return res.status(400).type("text/plain").send("Missing tenantId or jobId");
    }
    await resolveTenant(tenantId);
    let locale = lang;
    const sequelize = getSequelize();
    if (sequelize) {
      const { Tenant } = sequelize.models;
      const row = await Tenant.findOne({ where: { tenantId } });
      const pool = normalizeAvailableLanguages(row?.availableLanguages);
      locale = pool.includes(lang) ? lang : pool[0] ?? "en";
    } else if (lang !== "es" && lang !== "he") {
      locale = "en";
    }
    const job = await getJob(jobId);
    if (!job || job.tenantId !== tenantId) {
      return res.status(404).type("text/plain").send("Not found");
    }

    /** @type {any} */
    const bundle = job.transcriptNewsBundle && typeof job.transcriptNewsBundle === "object" ? job.transcriptNewsBundle : {};

    // Serve any completed job (realtime transcribe OR vod encode) that actually has news content.
    // News drafts are stored per job in transcriptNewsBundle (JSONB) + legacy plain fields.
    const bundleHasLocale = Object.keys(bundle).some((k) => k !== "version");
    const hasPlainNews = ["transcriptNewsEn", "transcriptNewsEs", "transcriptNewsHe"].some(
      (k) => typeof job[k] === "string" && job[k].trim(),
    );
    const hasNews = bundleHasLocale || hasPlainNews;
    if (job.status !== "completed" || !hasNews) {
      return res.status(404).type("text/plain").send("Not found");
    }
    const block = bundle[locale] && typeof bundle[locale] === "object" ? bundle[locale] : {};
    const plainKey = locale === "es" ? "transcriptNewsEs" : locale === "he" ? "transcriptNewsHe" : "transcriptNewsEn";
    const fallbackPlain = typeof job[plainKey] === "string" ? job[plainKey].trim() : "";
    const title = typeof block.title === "string" && block.title.trim() ? block.title.trim() : "News";
    const descriptionRaw =
      typeof block.description === "string" && block.description.trim()
        ? block.description.trim()
        : typeof block.subtitle === "string" && block.subtitle.trim()
          ? block.subtitle.trim()
          : "";
    const posterCaption =
      typeof block.posterCaption === "string" && block.posterCaption.trim() ? block.posterCaption.trim() : "";
    const date = typeof block.date === "string" ? block.date.trim() : "";
    const time = typeof block.time === "string" ? block.time.trim() : "";
    // Fall back to the VOD's default poster (editor upload / poster.jpg on tenant S3) persisted
    // on the job at creation, so news pages show an image even when the AI block has no posterUrl.
    const jobPosterUrl =
      job.editorSpec && typeof job.editorSpec === "object" && typeof job.editorSpec.__vodPosterUrl === "string"
        ? job.editorSpec.__vodPosterUrl.trim()
        : "";
    const blockPosterUrl =
      typeof block.posterUrl === "string" && /^https?:\/\//i.test(block.posterUrl.trim())
        ? block.posterUrl.trim()
        : "";
    const clipThumbUrl = clipThumbnailUrlFromSpec(job.editorSpec);
    const posterUrlHttp =
      blockPosterUrl ||
      (/^https?:\/\//i.test(jobPosterUrl) ? jobPosterUrl : "") ||
      (/^https?:\/\//i.test(clipThumbUrl) ? clipThumbUrl : "");
    const posterData =
      typeof block.posterDataUrl === "string" && block.posterDataUrl.trim().startsWith("data:")
        ? block.posterDataUrl.trim()
        : "";
    const posterImgSrc = posterUrlHttp || posterData;
    const posterIsHttp = Boolean(posterUrlHttp);
    let bodyHtml =
      typeof block.htmlBody === "string" && block.htmlBody.trim()
        ? stripScripts(block.htmlBody)
        : fallbackPlain
          ? `<div class="prose news-body">${escHtml(fallbackPlain).replace(/\n/g, "<br/>")}</div>`
          : "<p>No content.</p>";

    const bodyPlainSnippet = stripTagsPlain(bodyHtml).slice(0, 220);
    const ogDesc =
      descriptionRaw ||
      (bodyPlainSnippet ? bodyPlainSnippet.slice(0, 200) : fallbackPlain ? fallbackPlain.slice(0, 200) : title);
    const absUrl = `${req.protocol}://${req.get("host")}/api/public/transcript-news/${encodeURIComponent(tenantId)}/${encodeURIComponent(jobId)}?lang=${encodeURIComponent(locale)}`;

    const dateline = [date, time].filter(Boolean).join(" · ");
    const descriptionHtml = descriptionRaw
      ? `<p class="news-description">${escHtml(descriptionRaw)}</p>`
      : `<p class="news-description news-field-empty" aria-hidden="true">&#8203;</p>`;
    const datelineHtml = dateline
      ? `<p class="news-dateline meta">${escAttr(dateline)}</p>`
      : `<p class="news-dateline meta news-field-empty" aria-hidden="true">&#8203;</p>`;
    const posterFigureHtml = `<figure class="news-poster">${
      posterImgSrc
        ? `<img src="${escAttr(posterImgSrc)}" alt="${escAttr(title)}"/>`
        : `<div class="news-poster-placeholder" aria-hidden="true"></div>`
    }<figcaption class="news-poster-caption">${
      posterCaption ? escHtml(posterCaption) : `<span class="news-field-empty">&#8203;</span>`
    }</figcaption></figure>`;

    const html = `<!DOCTYPE html>
<html lang="${locale === "he" ? "he" : locale}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escAttr(title)}</title>
  <meta property="og:type" content="article"/>
  <meta property="og:title" content="${escAttr(title)}"/>
  <meta property="og:description" content="${escAttr(ogDesc)}"/>
  <meta property="og:url" content="${escAttr(absUrl)}"/>
  ${posterIsHttp ? `<meta property="og:image" content="${escAttr(posterUrlHttp)}"/>` : ""}
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escAttr(title)}"/>
  <meta name="twitter:description" content="${escAttr(ogDesc)}"/>
  ${posterIsHttp ? `<meta name="twitter:image" content="${escAttr(posterUrlHttp)}"/>` : ""}
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
    .meta, .news-dateline { color: #555; font-size: 0.9rem; margin: 0.35rem 0 0.75rem; }
    .news-description { font-size: 1.05rem; line-height: 1.5; margin: 0 0 0.75rem; color: #333; min-height: 1.25em; }
    .news-field-empty { opacity: 0.35; }
    figure.news-poster { margin: 1rem 0 1.25rem; }
    figure.news-poster img { max-width: 100%; height: auto; border-radius: 8px; display: block; }
    .news-poster-placeholder { min-height: 6rem; border-radius: 8px; background: #eee; border: 1px dashed #ccc; }
    figure.news-poster figcaption, .news-poster-caption { margin-top: 0.5rem; font-size: 0.9rem; color: #444; font-style: italic; line-height: 1.4; min-height: 1.1em; }
    .news-body { line-height: 1.65; margin-top: 0.5rem; }
    .news-body .prose { line-height: 1.65; }
  </style>
</head>
<body>
  <article class="news-article">
    <header class="news-header">
      <h1 class="news-title">${escAttr(title)}</h1>
      <section class="news-summary" aria-label="Description">${descriptionHtml}</section>
      ${datelineHtml}
    </header>
    <section class="news-media" aria-label="Poster">${posterFigureHtml}</section>
    <section class="news-body" aria-label="Article body"><div class="news-body-inner">${bodyHtml}</div></section>
  </article>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).send(html);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).type("text/plain").send(message);
  }
});
