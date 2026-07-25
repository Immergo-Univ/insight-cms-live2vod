import type { TranscriptDiarizationPayload, TranscriptNewsLocaleBlock } from "./vod-job";

/** Insight-api VOD content asset (flattened find response). */
export interface InsightVodContentItem {
  assetTypes?: string[];
  downloadUrl?: string;
  mime_type?: string;
  format?: string;
  type?: string;
  medium?: string;
  typeName?: string;
  name?: string;
  language?: string;
  languageName?: string;
  resolution?: string;
  duration?: number;
  m3u8?: string;
  timeFrom?: number;
  timeTo?: number;
  default?: boolean;
  status?: string;
  [key: string]: unknown;
}

/** One locale entry in Insight `fields.news[]`. */
export interface InsightVodNewsEntry {
  language: string;
  languageCode: string;
  title: string;
  description: string;
  posterCaption: string;
  date: string;
  time: string;
  htmlBody: string;
  posterUrl?: string | null;
  posterDataUrl?: string | null;
  text?: string;
}

/** One locale entry in Insight `fields.transcript[]`. */
export interface InsightVodTranscriptEntry {
  language: string;
  languageCode: string;
  text: string;
  diarization?: TranscriptDiarizationPayload | null;
}

/** Flattened Insight VOD document from find / by-guid. */
export interface InsightVodDocument {
  _id: string;
  guid: string;
  accountId?: string;
  userId?: string;
  title?: string;
  description?: string;
  publish_status?: string;
  vodType?: string;
  customerCode?: string;
  content?: InsightVodContentItem[];
  news?: InsightVodNewsEntry[];
  transcript?: InsightVodTranscriptEntry[];
  percent?: number;
  approved?: boolean;
  created?: number;
  updated?: number;
  commerceType?: string;
  activity?: Array<{ type?: string; date?: number; message?: string }>;
  [key: string]: unknown;
}

/** Linked Live2VOD job summary (not source of truth for AI fields). */
export interface VodAiJobSummary {
  id: string;
  status: string;
  progress: number;
  phase: string;
  jobKind?: string | null;
  editorClipId?: string | null;
  vodGuid?: string | null;
  outputUrl?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface VodAiPageResponse {
  vod: InsightVodDocument;
  job: VodAiJobSummary | null;
}

export interface VodAiPagePatchBody {
  news?: InsightVodNewsEntry[];
  transcript?: InsightVodTranscriptEntry[];
}

export function emptyNewsLocaleBlock(): TranscriptNewsLocaleBlock {
  const d = new Date();
  return {
    title: "",
    description: "",
    posterCaption: "",
    date: d.toISOString().slice(0, 10),
    time: d.toTimeString().slice(0, 5),
    posterUrl: null,
    posterDataUrl: null,
    htmlBody: "<p></p>",
  };
}

export function insightNewsToLocaleBlock(entry: InsightVodNewsEntry): TranscriptNewsLocaleBlock {
  return {
    title: String(entry.title ?? "").trim(),
    description: String(entry.description ?? "").trim(),
    posterCaption: String(entry.posterCaption ?? "").trim(),
    date: String(entry.date ?? "").trim(),
    time: String(entry.time ?? "").trim(),
    posterUrl: entry.posterUrl ?? null,
    posterDataUrl: entry.posterDataUrl ?? null,
    htmlBody: typeof entry.htmlBody === "string" && entry.htmlBody.trim() ? entry.htmlBody : "<p></p>",
  };
}

export function localeBlockToInsightNews(
  languageCode: string,
  language: string,
  block: TranscriptNewsLocaleBlock,
): InsightVodNewsEntry {
  return {
    language: language || languageCode,
    languageCode,
    title: block.title,
    description: block.description,
    posterCaption: block.posterCaption,
    date: block.date,
    time: block.time,
    htmlBody: block.htmlBody,
    posterUrl: block.posterUrl ?? null,
    posterDataUrl: block.posterDataUrl ?? null,
  };
}

/** Prefer HLS master, else first video download URL. */
export function resolveInsightVodPlaybackUrl(vod: InsightVodDocument): string | null {
  const content = Array.isArray(vod.content) ? vod.content : [];
  const hls = content.find(
    (c) =>
      Array.isArray(c.assetTypes) &&
      c.assetTypes.some((t) => String(t).toLowerCase() === "hls") &&
      typeof c.downloadUrl === "string" &&
      /^https?:\/\//i.test(c.downloadUrl),
  );
  if (hls?.downloadUrl) return hls.downloadUrl;
  const video = content.find(
    (c) =>
      (c.type === "video" || c.medium === "video") &&
      typeof c.downloadUrl === "string" &&
      /^https?:\/\//i.test(c.downloadUrl),
  );
  return video?.downloadUrl ?? null;
}

/** Default poster from content[] Poster H / first image. */
export function resolveInsightVodPosterUrl(vod: InsightVodDocument): string | null {
  const content = Array.isArray(vod.content) ? vod.content : [];
  const poster = content.find(
    (c) =>
      Array.isArray(c.assetTypes) &&
      c.assetTypes.some((t) => /poster/i.test(String(t))) &&
      typeof c.downloadUrl === "string" &&
      /^https?:\/\//i.test(c.downloadUrl),
  );
  if (poster?.downloadUrl) return poster.downloadUrl;
  const img = content.find(
    (c) => c.type === "image" && typeof c.downloadUrl === "string" && /^https?:\/\//i.test(c.downloadUrl),
  );
  return img?.downloadUrl ?? null;
}
