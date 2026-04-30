export type VodJobStatus =
  | "queued"
  | "processing"
  | "uploading"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export type VodJobKind = "vod_encode" | "realtime_transcribe";

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
  /** OpenAI news article derived from the transcript (English). */
  transcriptNewsEn?: string;
  /** OpenAI news article (Spanish). */
  transcriptNewsEs?: string;
  /** OpenAI news article (Hebrew). */
  transcriptNewsHe?: string;
  /** Set when news generation was attempted but failed; raw transcript may still be present. */
  transcriptNewsError?: string;
  /** When set, this job was started from the editor for a specific sub-clip row. */
  editorClipId?: string;
  createdAt: string;
  updatedAt?: string;
  clipUrl?: string;
  s3Key?: string;
  s3Keys?: string[];
  outputUrl?: string | null;
  /** One public URL per encoded clip (same order as spec.clips by order). */
  outputUrls?: (string | null)[];
}
