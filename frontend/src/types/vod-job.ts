import type { EditorStateJson } from "./editor";

export type VodJobStatus =
  | "queued"
  | "processing"
  | "uploading"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export type VodJobKind = "vod_encode" | "realtime_transcribe";

export interface TranscriptDiarizationSegment {
  speaker: string;
  text: string;
  start?: number;
  end?: number;
}

/** Diarized STT payload (segments + optional manual speaker name overrides). */
export interface TranscriptDiarizationPayload {
  version?: number;
  segments: TranscriptDiarizationSegment[];
  speakerLabels?: Record<string, string>;
}

/** Rich news card fields for one locale (editor + public share HTML). */
export interface TranscriptNewsLocaleBlock {
  title: string;
  /** Summary / lead; used for og:description and public article intro. */
  description: string;
  /** Caption under the poster image (copete). */
  posterCaption: string;
  date: string;
  time: string;
  /** Remote poster URL (e.g. thumbnail service) for og:image. */
  posterUrl?: string | null;
  /** Inline image data URL for preview when no posterUrl. */
  posterDataUrl?: string | null;
  htmlBody: string;
  /** @deprecated Old field; merged into `description` when loading legacy bundles. */
  subtitle?: string;
}

export interface TranscriptNewsBundle {
  version: number;
  en?: TranscriptNewsLocaleBlock;
  es?: TranscriptNewsLocaleBlock;
  he?: TranscriptNewsLocaleBlock;
  /** Any additional tenant locale (e.g. "ar"): the bundle is keyed by ISO 639-1 code. */
  [locale: string]: TranscriptNewsLocaleBlock | number | undefined;
}

/** OpenAI usage rollup saved on realtime transcribe jobs (encoder → backend). */
export interface OpenAiClipUsageReport {
  version?: number;
  currency?: string;
  totalTokens?: number;
  estimatedTotalUsd?: number;
  pricingNote?: string;
  steps?: Array<{
    step?: string;
    model?: string;
    chunkIndex?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    audioSeconds?: number;
    estimatedUsd?: number;
  }>;
}

/** Latest MP4 encode job for a sub-clip (ignores realtime transcript jobs). */
export function pickLatestVodEncodeJobForEditorClip(
  jobs: VodJobRecord[],
  clipId: string,
): VodJobRecord | undefined {
  let best: VodJobRecord | undefined;
  for (const j of jobs) {
    if (j.editorClipId !== clipId) continue;
    if (j.jobKind === "realtime_transcribe") continue;
    if (!best || j.createdAt > best.createdAt) best = j;
  }
  return best;
}

/** Latest realtime transcript-only job for a sub-clip. */
export function pickLatestRealtimeTranscribeJobForEditorClip(
  jobs: VodJobRecord[],
  clipId: string,
): VodJobRecord | undefined {
  let best: VodJobRecord | undefined;
  for (const j of jobs) {
    if (j.editorClipId !== clipId) continue;
    if (j.jobKind !== "realtime_transcribe") continue;
    if (!best || j.createdAt > best.createdAt) best = j;
  }
  return best;
}

export interface VodJobRecord {
  id: string;
  tenantId: string;
  status: VodJobStatus;
  progress: number;
  phase: string;
  message?: string;
  error?: string;
  /** Distinguishes MP4 encode jobs from realtime audio-only transcript jobs. */
  jobKind?: VodJobKind;
  /** Plain transcript from realtime_transcribe jobs when completed. */
  transcriptText?: string;
  /** Diarized segments and speaker label overrides when STT used speaker diarization. */
  transcriptDiarization?: TranscriptDiarizationPayload | null;
  /** Token usage + estimated USD for STT / speaker infer / news on this clip job. */
  openaiClipUsage?: OpenAiClipUsageReport | null;
  /** OpenAI news article derived from the transcript (English). */
  transcriptNewsEn?: string;
  /** OpenAI news article (Spanish). */
  transcriptNewsEs?: string;
  /** OpenAI news article (Hebrew). */
  transcriptNewsHe?: string;
  /** Set when news generation was attempted but failed; raw transcript may still be present. */
  transcriptNewsError?: string;
  /** Editable rich news (title, poster, WYSIWYG body) per locale; optional until user saves from editor. */
  transcriptNewsBundle?: TranscriptNewsBundle | null;
  /** When set, this job was started from the editor for a specific sub-clip row. */
  editorClipId?: string;
  /** Full editor JSON spec at job creation (subtitles, syndication, etc.). */
  editorSpec?: EditorStateJson | null;
  createdAt: string;
  updatedAt?: string;
  clipUrl?: string;
  s3Key?: string;
  s3Keys?: string[];
  outputUrl?: string | null;
  /** One public URL per encoded clip (same order as spec.clips by order). */
  outputUrls?: (string | null)[];
}
