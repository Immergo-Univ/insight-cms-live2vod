export type TenantSyndicationFacebookStatus = {
  connected: boolean;
  pageSelected: boolean;
  pageId: string | null;
  pageName: string | null;
  mockAuthAvailable?: boolean;
};

export type TenantSyndicationInstagramStatus = {
  connected: boolean;
  accountSelected: boolean;
  businessAccountId: string | null;
  username: string | null;
  mockAuthAvailable?: boolean;
};

export type TenantSyndicationTiktokStatus = {
  connected: boolean;
  username: string | null;
  mockAuthAvailable?: boolean;
};

export type TenantSyndicationStatus = {
  youtube: { connected: boolean; mockAuthAvailable?: boolean };
  twitter: { connected: boolean; mockAuthAvailable?: boolean };
  facebook: TenantSyndicationFacebookStatus;
  instagram: TenantSyndicationInstagramStatus;
  tiktok: TenantSyndicationTiktokStatus;
};

export type FacebookPageOption = { id: string; name: string };
export type InstagramAccountOption = { id: string; username: string; pageName?: string };

export type TiktokCreatorInfo = {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

function normalizeStatus(data: TenantSyndicationStatus & { error?: string }): TenantSyndicationStatus {
  return {
    youtube: {
      connected: !!data.youtube?.connected,
      mockAuthAvailable: !!data.youtube?.mockAuthAvailable,
    },
    twitter: {
      connected: !!data.twitter?.connected,
      mockAuthAvailable: !!data.twitter?.mockAuthAvailable,
    },
    facebook: {
      connected: !!data.facebook?.connected,
      pageSelected: !!data.facebook?.pageSelected,
      pageId: data.facebook?.pageId ?? null,
      pageName: data.facebook?.pageName ?? null,
      mockAuthAvailable: !!data.facebook?.mockAuthAvailable,
    },
    instagram: {
      connected: !!data.instagram?.connected,
      accountSelected: !!data.instagram?.accountSelected,
      businessAccountId: data.instagram?.businessAccountId ?? null,
      username: data.instagram?.username ?? null,
      mockAuthAvailable: !!data.instagram?.mockAuthAvailable,
    },
    tiktok: {
      connected: !!data.tiktok?.connected,
      username: data.tiktok?.username ?? null,
      mockAuthAvailable: !!data.tiktok?.mockAuthAvailable,
    },
  };
}

export async function fetchTenantSyndicationStatus(tenantId: string): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication`);
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return normalizeStatus(data);
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
  return normalizeStatus(data);
}

export async function fetchTenantSyndicationTwitterAuthUrl(tenantId: string): Promise<string> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/twitter/auth-url`);
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.url) throw new Error("Missing OAuth URL");
  return data.url;
}

export async function postTenantSyndicationTwitterMockAuthorize(
  tenantId: string,
): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/twitter/mock-authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return normalizeStatus(data);
}

export async function fetchTenantSyndicationFacebookAuthUrl(tenantId: string): Promise<string> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/facebook/auth-url`);
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.url) throw new Error("Missing OAuth URL");
  return data.url;
}

export async function fetchTenantSyndicationFacebookPages(tenantId: string): Promise<FacebookPageOption[]> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/facebook/pages`);
  const data = (await res.json()) as { pages?: FacebookPageOption[]; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return Array.isArray(data.pages) ? data.pages : [];
}

export async function postTenantSyndicationFacebookSelectPage(
  tenantId: string,
  pageId: string,
): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/facebook/select-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageId }),
  });
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return normalizeStatus(data);
}

export async function postTenantSyndicationFacebookMockAuthorize(
  tenantId: string,
): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/facebook/mock-authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return normalizeStatus(data);
}

export async function fetchTenantSyndicationInstagramAuthUrl(tenantId: string): Promise<string> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/instagram/auth-url`);
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.url) throw new Error("Missing OAuth URL");
  return data.url;
}

export async function fetchTenantSyndicationInstagramAccounts(
  tenantId: string,
): Promise<InstagramAccountOption[]> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/instagram/accounts`);
  const data = (await res.json()) as { accounts?: InstagramAccountOption[]; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return Array.isArray(data.accounts) ? data.accounts : [];
}

export async function postTenantSyndicationInstagramSelectAccount(
  tenantId: string,
  businessAccountId: string,
): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/instagram/select-account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessAccountId }),
  });
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return normalizeStatus(data);
}

export async function postTenantSyndicationInstagramMockAuthorize(
  tenantId: string,
): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/instagram/mock-authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return normalizeStatus(data);
}

export async function fetchTenantSyndicationTiktokAuthUrl(tenantId: string): Promise<string> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/tiktok/auth-url`);
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.url) throw new Error("Missing OAuth URL");
  return data.url;
}

export async function fetchTenantSyndicationTiktokCreatorInfo(tenantId: string): Promise<TiktokCreatorInfo> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/tiktok/creator-info`);
  const data = (await res.json()) as { creatorInfo?: TiktokCreatorInfo; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.creatorInfo && typeof data.creatorInfo === "object" ? data.creatorInfo : {};
}

export async function postTenantSyndicationTiktokMockAuthorize(
  tenantId: string,
): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/tiktok/mock-authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return normalizeStatus(data);
}
