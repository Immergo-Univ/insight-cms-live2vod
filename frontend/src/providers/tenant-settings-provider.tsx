import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { postTenantEnsure, type TenantDto } from "@/services/tenant-bff.service";

type TenantSettingsContextValue = {
  tenantId: string;
  tenant: TenantDto | null;
  loading: boolean;
  /** When false, hide subtitle / realtime transcribe controls for this tenant. */
  subtitlesEnabled: boolean;
  /** When true, new clips start with subtitle mode enabled by default. */
  subtitlesDefaultEnabled: boolean;
  /** When true, show per-clip syndication UI for YouTube. */
  syndicationYoutubeEnabled: boolean;
  /** When true, new clips start with YouTube syndication enabled by default. */
  syndicationYoutubeDefaultEnabled: boolean;
  /** When true, show per-clip syndication UI for X / Twitter. */
  syndicationTwitterEnabled: boolean;
  /** When true, new clips start with X syndication enabled by default. */
  syndicationTwitterDefaultEnabled: boolean;
  /** When true, show per-clip syndication UI for Facebook. */
  syndicationFacebookEnabled: boolean;
  /** When true, new clips start with Facebook syndication enabled by default. */
  syndicationFacebookDefaultEnabled: boolean;
  /** When true, show per-clip syndication UI for Instagram. */
  syndicationInstagramEnabled: boolean;
  /** When true, new clips start with Instagram syndication enabled by default. */
  syndicationInstagramDefaultEnabled: boolean;
  /** When true, show per-clip syndication UI for TikTok. */
  syndicationTiktokEnabled: boolean;
  /** When true, new clips start with TikTok syndication enabled by default. */
  syndicationTiktokDefaultEnabled: boolean;
  refresh: () => Promise<void>;
};

const TenantSettingsContext = createContext<TenantSettingsContextValue | null>(null);

function readTenantIdFromSearch(search: string): string {
  try {
    return new URLSearchParams(search).get("tenantId")?.trim() || "";
  } catch {
    return "";
  }
}

function readTzFromSearch(search: string): string | undefined {
  try {
    const t = new URLSearchParams(search).get("tz")?.trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export function TenantSettingsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const tenantId = useMemo(() => readTenantIdFromSearch(location.search), [location.search]);
  const tz = useMemo(() => readTzFromSearch(location.search), [location.search]);

  const [tenant, setTenant] = useState<TenantDto | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setTenant(null);
      return;
    }
    setLoading(true);
    try {
      const t = await postTenantEnsure({
        tenantId,
        tz,
        metadata: { lastPath: location.pathname },
      });
      setTenant(t);
    } catch {
      setTenant(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, tz, location.pathname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const q = new URLSearchParams(location.search);
      let changed = false;
      if (q.get("youtubeConnected") === "1") {
        q.delete("youtubeConnected");
        changed = true;
      }
      if (q.get("twitterConnected") === "1") {
        q.delete("twitterConnected");
        changed = true;
      }
      if (q.get("facebookConnected") === "1") {
        q.delete("facebookConnected");
        changed = true;
      }
      if (q.get("instagramConnected") === "1") {
        q.delete("instagramConnected");
        changed = true;
      }
      if (q.get("tiktokConnected") === "1") {
        q.delete("tiktokConnected");
        changed = true;
      }
      const duplicateChecks: Array<[string, string]> = [
        ["youtubeDuplicate", "This YouTube account is already authorized."],
        ["twitterDuplicate", "This X account is already authorized."],
        ["facebookDuplicate", "This Facebook Page is already authorized."],
        ["instagramDuplicate", "This Instagram account is already authorized."],
        ["tiktokDuplicate", "This TikTok account is already authorized."],
      ];
      for (const [key, message] of duplicateChecks) {
        if (q.get(key) === "1") {
          toast.info(message);
          q.delete(key);
          changed = true;
        }
      }
      if (q.get("facebookPending") === "1") {
        q.delete("facebookPending");
        changed = true;
      }
      if (q.get("instagramPending") === "1") {
        q.delete("instagramPending");
        changed = true;
      }
      if (q.get("accountId")) {
        q.delete("accountId");
        changed = true;
      }
      if (changed) {
        const next = `${location.pathname}${q.toString() ? `?${q.toString()}` : ""}${location.hash}`;
        window.history.replaceState({}, "", next);
        void refresh();
      }
    } catch {
      /* ignore */
    }
  }, [location.search, location.pathname, location.hash, refresh]);

  const subtitlesEnabled = !tenantId || tenant?.subtitlesEnabled !== false;
  const subtitlesDefaultEnabled = Boolean(tenantId && tenant?.subtitlesDefaultEnabled === true);
  const syndicationYoutubeEnabled = Boolean(tenantId && tenant?.syndicationYoutubeEnabled === true);
  const syndicationYoutubeDefaultEnabled = Boolean(tenantId && tenant?.syndicationYoutubeDefaultEnabled === true);
  const syndicationTwitterEnabled = Boolean(tenantId && tenant?.syndicationTwitterEnabled === true);
  const syndicationTwitterDefaultEnabled = Boolean(tenantId && tenant?.syndicationTwitterDefaultEnabled === true);
  const syndicationFacebookEnabled = Boolean(tenantId && tenant?.syndicationFacebookEnabled === true);
  const syndicationFacebookDefaultEnabled = Boolean(tenantId && tenant?.syndicationFacebookDefaultEnabled === true);
  const syndicationInstagramEnabled = Boolean(tenantId && tenant?.syndicationInstagramEnabled === true);
  const syndicationInstagramDefaultEnabled = Boolean(tenantId && tenant?.syndicationInstagramDefaultEnabled === true);
  const syndicationTiktokEnabled = Boolean(tenantId && tenant?.syndicationTiktokEnabled === true);
  const syndicationTiktokDefaultEnabled = Boolean(tenantId && tenant?.syndicationTiktokDefaultEnabled === true);

  const value = useMemo(
    () => ({
      tenantId,
      tenant,
      loading,
      subtitlesEnabled,
      subtitlesDefaultEnabled,
      syndicationYoutubeEnabled,
      syndicationYoutubeDefaultEnabled,
      syndicationTwitterEnabled,
      syndicationTwitterDefaultEnabled,
      syndicationFacebookEnabled,
      syndicationFacebookDefaultEnabled,
      syndicationInstagramEnabled,
      syndicationInstagramDefaultEnabled,
      syndicationTiktokEnabled,
      syndicationTiktokDefaultEnabled,
      refresh,
    }),
    [
      tenantId,
      tenant,
      loading,
      subtitlesEnabled,
      subtitlesDefaultEnabled,
      syndicationYoutubeEnabled,
      syndicationYoutubeDefaultEnabled,
      syndicationTwitterEnabled,
      syndicationTwitterDefaultEnabled,
      syndicationFacebookEnabled,
      syndicationFacebookDefaultEnabled,
      syndicationInstagramEnabled,
      syndicationInstagramDefaultEnabled,
      syndicationTiktokEnabled,
      syndicationTiktokDefaultEnabled,
      refresh,
    ],
  );

  return <TenantSettingsContext.Provider value={value}>{children}</TenantSettingsContext.Provider>;
}

export function useTenantSettings(): TenantSettingsContextValue {
  const ctx = useContext(TenantSettingsContext);
  if (!ctx) throw new Error("useTenantSettings must be used within TenantSettingsProvider");
  return ctx;
}
