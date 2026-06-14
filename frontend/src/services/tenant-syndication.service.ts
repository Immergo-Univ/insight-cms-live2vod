export type SyndicationAccountSummary = {
  id: string;
  displayName: string;
  status: "active" | "pending_selection";
};

export type TenantSyndicationPlatformStatus = {
  connected: boolean;
  accounts: SyndicationAccountSummary[];
  pendingAccountId?: string | null;
  mockAuthAvailable?: boolean;
  maxAccounts?: number;
  accountCount?: number;
  canAddAccount?: boolean;
};

export type TenantSyndicationFacebookStatus = TenantSyndicationPlatformStatus & {
  pageSelected: boolean;
  pageId: string | null;
  pageName: string | null;
};

export type TenantSyndicationInstagramStatus = TenantSyndicationPlatformStatus & {
  accountSelected: boolean;
  businessAccountId: string | null;
  username: string | null;
};

export type TenantSyndicationTiktokStatus = TenantSyndicationPlatformStatus & {
  username: string | null;
};

export type TenantSyndicationStatus = {
  youtube: TenantSyndicationPlatformStatus;
  twitter: TenantSyndicationPlatformStatus;
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

function normalizeAccounts(raw: unknown): SyndicationAccountSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (!id) return null;
      return {
        id,
        displayName: typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim() : id,
        status: row.status === "pending_selection" ? "pending_selection" : "active",
      };
    })
    .filter(Boolean) as SyndicationAccountSummary[];
}

function normalizePlatform(data: Record<string, unknown> | undefined): TenantSyndicationPlatformStatus {
  const maxAccountsRaw = Number(data?.maxAccounts);
  const accountCountRaw = Number(data?.accountCount);
  const maxAccounts = Number.isFinite(maxAccountsRaw) && maxAccountsRaw >= 1 ? Math.floor(maxAccountsRaw) : 5;
  const accountCount = Number.isFinite(accountCountRaw) && accountCountRaw >= 0 ? Math.floor(accountCountRaw) : 0;
  return {
    connected: !!data?.connected,
    accounts: normalizeAccounts(data?.accounts),
    pendingAccountId:
      typeof data?.pendingAccountId === "string" && data.pendingAccountId.trim()
        ? data.pendingAccountId.trim()
        : null,
    mockAuthAvailable: !!data?.mockAuthAvailable,
    maxAccounts,
    accountCount,
    canAddAccount: data?.canAddAccount === false ? false : accountCount < maxAccounts,
  };
}

function normalizeStatus(data: TenantSyndicationStatus & { error?: string }): TenantSyndicationStatus {
  const youtube = normalizePlatform(data.youtube as Record<string, unknown>);
  const twitter = normalizePlatform(data.twitter as Record<string, unknown>);
  const facebookRaw = (data.facebook ?? {}) as Record<string, unknown>;
  const instagramRaw = (data.instagram ?? {}) as Record<string, unknown>;
  const tiktokRaw = (data.tiktok ?? {}) as Record<string, unknown>;
  const facebook = normalizePlatform(facebookRaw);
  const instagram = normalizePlatform(instagramRaw);
  const tiktok = normalizePlatform(tiktokRaw);

  return {
    youtube,
    twitter,
    facebook: {
      ...facebook,
      pageSelected: !!facebookRaw.pageSelected,
      pageId: typeof facebookRaw.pageId === "string" ? facebookRaw.pageId : null,
      pageName: typeof facebookRaw.pageName === "string" ? facebookRaw.pageName : null,
    },
    instagram: {
      ...instagram,
      accountSelected: !!instagramRaw.accountSelected,
      businessAccountId: typeof instagramRaw.businessAccountId === "string" ? instagramRaw.businessAccountId : null,
      username: typeof instagramRaw.username === "string" ? instagramRaw.username : null,
    },
    tiktok: {
      ...tiktok,
      username: typeof tiktokRaw.username === "string" ? tiktokRaw.username : null,
    },
  };
}

export class SyndicationDuplicateAccountError extends Error {
  code = "DUPLICATE_ACCOUNT" as const;
  constructor(message = "This account is already authorized") {
    super(message);
    this.name = "SyndicationDuplicateAccountError";
  }
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

export async function fetchTenantSyndicationFacebookPages(
  tenantId: string,
  accountId?: string,
): Promise<FacebookPageOption[]> {
  const id = tenantId.trim();
  const q = accountId?.trim() ? `?accountId=${encodeURIComponent(accountId.trim())}` : "";
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/facebook/pages${q}`);
  const data = (await res.json()) as { pages?: FacebookPageOption[]; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return Array.isArray(data.pages) ? data.pages : [];
}

export async function postTenantSyndicationFacebookSelectPage(
  tenantId: string,
  pageId: string,
  accountId?: string,
): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/facebook/select-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageId, ...(accountId?.trim() ? { accountId: accountId.trim() } : {}) }),
  });
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string; code?: string };
  if (res.status === 409 || data.code === "DUPLICATE_ACCOUNT") {
    throw new SyndicationDuplicateAccountError(data.error || "This Facebook Page is already authorized");
  }
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
  accountId?: string,
): Promise<InstagramAccountOption[]> {
  const id = tenantId.trim();
  const q = accountId?.trim() ? `?accountId=${encodeURIComponent(accountId.trim())}` : "";
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/instagram/accounts${q}`);
  const data = (await res.json()) as { accounts?: InstagramAccountOption[]; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return Array.isArray(data.accounts) ? data.accounts : [];
}

export async function postTenantSyndicationInstagramSelectAccount(
  tenantId: string,
  businessAccountId: string,
  accountId?: string,
): Promise<TenantSyndicationStatus> {
  const id = tenantId.trim();
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}/syndication/instagram/select-account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessAccountId,
      ...(accountId?.trim() ? { accountId: accountId.trim() } : {}),
    }),
  });
  const data = (await res.json()) as TenantSyndicationStatus & { error?: string; code?: string };
  if (res.status === 409 || data.code === "DUPLICATE_ACCOUNT") {
    throw new SyndicationDuplicateAccountError(data.error || "This Instagram account is already authorized");
  }
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
