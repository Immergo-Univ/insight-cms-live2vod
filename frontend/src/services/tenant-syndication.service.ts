export type TenantSyndicationStatus = {
  youtube: { connected: boolean; mockAuthAvailable?: boolean };
};

export async function fetchTenantSyndicationStatus(tenantId: string): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication`);
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return {
    youtube: {
      connected: !!data.youtube?.connected,
      mockAuthAvailable: !!data.youtube?.mockAuthAvailable,
    },
  };
}

export async function fetchTenantSyndicationYoutubeAuthUrl(tenantId: string): Promise<string> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/youtube/auth-url`);
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.url) throw new Error("Missing OAuth URL");
  return data.url;
}

export async function postTenantSyndicationYoutubeMockAuthorize(
  tenantId: string,
): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/youtube/mock-authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return {
    youtube: {
      connected: !!data.youtube?.connected,
      mockAuthAvailable: !!data.youtube?.mockAuthAvailable,
    },
  };
}
