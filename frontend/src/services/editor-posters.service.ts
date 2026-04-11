import { httpClient } from "./http-client";

export interface EditorPosterUploadRow {
  id: string;
  originalName: string;
  storedRelative: string;
  mime: string;
  previewUrl: string;
}

export async function uploadEditorPosters(
  channelId: string,
  files: File[],
): Promise<EditorPosterUploadRow[]> {
  const form = new FormData();
  for (const f of files) {
    form.append("posters", f);
  }
  const tenantId = httpClient.getTenantId();
  const url = `/api/channels/${encodeURIComponent(channelId)}/editor/posters`;
  const res = await fetch(url, {
    method: "POST",
    headers: tenantId ? { "x-tenant-id": tenantId } : {},
    body: form,
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    posters?: EditorPosterUploadRow[];
  };
  if (!res.ok) {
    throw new Error(payload.error || res.statusText || "Upload failed");
  }
  return payload.posters ?? [];
}

export async function deleteEditorPoster(channelId: string, posterId: string): Promise<void> {
  const client = httpClient.getBffClient();
  await client.delete(
    `/channels/${encodeURIComponent(channelId)}/editor/posters/${encodeURIComponent(posterId)}`,
  );
}
