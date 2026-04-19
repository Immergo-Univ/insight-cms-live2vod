import { httpClient } from "./http-client";

/** Uploads raw image bytes to the API for storage/CDN URLs; VOD widget rendering runs in encoder-lite only. */

/** Response row from POST .../editor/widget-images (public CDN `src` when S3 is configured). */
export interface EditorWidgetImageUploadRow {
  id: string;
  originalName: string;
  storedRelative: string;
  mime: string;
  /** Public URL for VOD encoder (HTTPS CDN when S3 + S3_CDN are set). */
  src: string;
  previewUrl: string;
}

export async function uploadEditorWidgetImages(
  channelId: string,
  files: File[],
): Promise<EditorWidgetImageUploadRow[]> {
  const form = new FormData();
  for (const f of files) {
    form.append("widgetImages", f);
  }
  const tenantId = httpClient.getTenantId();
  const url = `/api/channels/${encodeURIComponent(channelId)}/editor/widget-images`;
  const res = await fetch(url, {
    method: "POST",
    headers: tenantId ? { "x-tenant-id": tenantId } : {},
    body: form,
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    images?: EditorWidgetImageUploadRow[];
  };
  if (!res.ok) {
    throw new Error(payload.error || res.statusText || "Widget image upload failed");
  }
  return payload.images ?? [];
}
