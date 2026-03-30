import { httpClient } from "./http-client";

export interface ChannelLogoRow {
  id: string;
  originalName: string;
  storedRelative: string;
  mime: string;
  uploadedAt: string;
  previewUrl: string;
}

export interface ChannelSettingsResponse {
  channelId: string;
  logos: ChannelLogoRow[];
  updatedAt: string | null;
}

export async function fetchChannelSettings(channelId: string): Promise<ChannelSettingsResponse> {
  const client = httpClient.getBffClient();
  const response = await client.get<ChannelSettingsResponse>(
    `/channels/${encodeURIComponent(channelId)}/settings`,
  );
  return response.data;
}

export async function uploadChannelLogos(channelId: string, files: File[]): Promise<ChannelSettingsResponse> {
  const form = new FormData();
  for (const f of files) {
    form.append("logos", f);
  }
  // Do not use the shared Axios BFF client here: its default Content-Type: application/json breaks
  // multipart parsing on the server. fetch lets the browser set multipart boundary automatically.
  const tenantId = httpClient.getTenantId();
  const url = `/api/channels/${encodeURIComponent(channelId)}/settings/logos`;
  const res = await fetch(url, {
    method: "POST",
    headers: tenantId ? { "x-tenant-id": tenantId } : {},
    body: form,
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string } & ChannelSettingsResponse & {
    added?: ChannelLogoRow[];
  };
  if (!res.ok) {
    throw new Error(payload.error || res.statusText || "Upload failed");
  }
  return {
    channelId: payload.channelId,
    logos: payload.logos,
    updatedAt: payload.updatedAt ?? null,
  };
}

export async function deleteChannelLogo(channelId: string, logoId: string): Promise<void> {
  const client = httpClient.getBffClient();
  await client.delete(`/channels/${encodeURIComponent(channelId)}/settings/logos/${encodeURIComponent(logoId)}`);
}
