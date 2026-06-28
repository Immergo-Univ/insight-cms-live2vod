export type TenantDto = {
  tenantId: string;
  subtitlesEnabled: boolean;
  subtitlesDefaultEnabled?: boolean;
  availableLanguages?: string[];
  newsButtonEnabled?: boolean;
  newsDefaultGenerate?: boolean;
  subtitlesTranscriptNewsUiEnabled?: boolean;
  subtitlesDefaultBurnIn?: boolean;
  subtitlesDefaultDiarization?: boolean;
  subtitlesDefaultInferSpeakerNames?: boolean;
  subtitlesDefaultNewsEn?: boolean;
  subtitlesDefaultNewsEs?: boolean;
  subtitlesDefaultNewsHe?: boolean;
  syndicationYoutubeEnabled?: boolean;
  syndicationYoutubeDefaultEnabled?: boolean;
  syndicationYoutubeConnected?: boolean;
  syndicationTwitterEnabled?: boolean;
  syndicationTwitterDefaultEnabled?: boolean;
  syndicationTwitterConnected?: boolean;
  syndicationFacebookEnabled?: boolean;
  syndicationFacebookDefaultEnabled?: boolean;
  syndicationFacebookConnected?: boolean;
  facebookPageId?: string | null;
  facebookPageName?: string | null;
  facebookPageSelected?: boolean;
  syndicationInstagramEnabled?: boolean;
  syndicationInstagramDefaultEnabled?: boolean;
  syndicationInstagramConnected?: boolean;
  instagramBusinessAccountId?: string | null;
  instagramUsername?: string | null;
  instagramAccountSelected?: boolean;
  syndicationTiktokEnabled?: boolean;
  syndicationTiktokDefaultEnabled?: boolean;
  syndicationTiktokConnected?: boolean;
  tiktokUsername?: string | null;
  timezoneLastSeen: string | null;
  metadata: Record<string, unknown> | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export async function postTenantEnsure(body: {
  tenantId: string;
  tz?: string;
  metadata?: Record<string, unknown>;
}): Promise<TenantDto> {
  const res = await fetch("/api/tenants/ensure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId: body.tenantId,
      tz: body.tz,
      metadata: body.metadata,
    }),
  });
  const data = (await res.json()) as { tenant?: TenantDto; error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.tenant) throw new Error("Invalid response");
  return data.tenant;
}
