import type { TranscriptNewsLocaleBlock } from "@/types/vod-job";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build a self-contained HTML fragment for the news article.
 * Always emits title, description, poster block (image + figcaption), and body — same structure as the public page.
 */
export function buildTranscriptNewsArticleHtml(
  block: TranscriptNewsLocaleBlock,
  posterSrc: string,
): string {
  const title = esc((block.title || "News").trim());
  const description = String(block.description ?? "").trim();
  const posterCaption = String(block.posterCaption ?? "").trim();
  const body = block.htmlBody?.trim() ? block.htmlBody : "<p></p>";
  const poster = posterSrc.trim();

  const parts: string[] = [];
  parts.push(`<article class="transcript-news-article">`);
  parts.push(`<header class="news-header">`);
  parts.push(`<h1 class="news-title">${title}</h1>`);
  parts.push(
    `<section class="news-summary" aria-label="Description"><p class="news-description">${description ? esc(description) : `<span class="news-field-empty"> </span>`}</p></section>`,
  );
  const date = String(block.date ?? "").trim();
  const time = String(block.time ?? "").trim();
  const dateline = [date, time].filter(Boolean).join(" · ");
  parts.push(
    `<p class="news-dateline meta">${dateline ? esc(dateline) : `<span class="news-field-empty"> </span>`}</p>`,
  );
  parts.push(`</header>`);
  parts.push(`<section class="news-media" aria-label="Poster">`);
  parts.push(`<figure class="news-poster">`);
  if (poster) {
    parts.push(`<img src="${escAttr(poster)}" alt="${title}"/>`);
  } else {
    parts.push(`<div class="news-poster-placeholder" aria-hidden="true"></div>`);
  }
  parts.push(
    `<figcaption class="news-poster-caption">${posterCaption ? esc(posterCaption) : `<span class="news-field-empty"> </span>`}</figcaption>`,
  );
  parts.push(`</figure>`);
  parts.push(`</section>`);
  parts.push(`<section class="news-body" aria-label="Article body"><div class="news-body-inner">${body}</div></section>`);
  parts.push(`</article>`);
  return parts.join("\n");
}
