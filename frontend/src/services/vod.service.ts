import { httpClient } from "./http-client";
import type { EditorStateJson } from "@/types/editor";
import type { TranscriptNewsBundle, VodJobRecord } from "@/types/vod-job";

export async function startVodJob(
  spec: EditorStateJson,
  opts?: { editorClipId?: string },
): Promise<{ jobId: string; status: string }> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const body =
    opts?.editorClipId && opts.editorClipId.trim().length > 0
      ? { spec, editorClipId: opts.editorClipId.trim() }
      : { spec };
  const { data } = await client.post<{ jobId: string; status: string }>(
    "/vod/jobs",
    body,
    { params: { tenantId } },
  );
  return data;
}

export async function fetchVodJobs(): Promise<VodJobRecord[]> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const { data } = await client.get<{ jobs: VodJobRecord[] }>("/vod/jobs", {
    params: { tenantId },
  });
  return data.jobs ?? [];
}

export async function cancelVodJob(jobId: string): Promise<void> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  await client.post(`/vod/jobs/${encodeURIComponent(jobId)}/cancel`, {}, {
    params: { tenantId },
  });
}

/** Merge manual speaker display names and rebuild transcriptText (diarized jobs only). */
export async function patchVodJobTranscriptSpeakers(
  jobId: string,
  transcriptSpeakerLabels: Record<string, string>,
): Promise<VodJobRecord> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const { data } = await client.patch<{ ok?: boolean; job: VodJobRecord }>(
    `/vod/jobs/${encodeURIComponent(jobId)}`,
    { transcriptSpeakerLabels },
    { params: { tenantId } },
  );
  return data.job;
}

/** Persist rich news fields (WYSIWYG + metadata) for a realtime transcript job. */
export async function patchVodJobNewsBundle(
  jobId: string,
  transcriptNewsBundle: TranscriptNewsBundle,
): Promise<VodJobRecord> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const { data } = await client.patch<{ ok?: boolean; job: VodJobRecord }>(
    `/vod/jobs/${encodeURIComponent(jobId)}`,
    { transcriptNewsBundle },
    { params: { tenantId } },
  );
  return data.job;
}

export interface VodS3ObjectRow {
  key: string;
  size?: number;
  lastModified?: string;
  publicUrl: string | null;
}

export async function fetchVodOutputs(): Promise<VodS3ObjectRow[]> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const { data } = await client.get<{ objects: VodS3ObjectRow[] }>("/vod/outputs", {
    params: { tenantId },
  });
  return data.objects ?? [];
}
