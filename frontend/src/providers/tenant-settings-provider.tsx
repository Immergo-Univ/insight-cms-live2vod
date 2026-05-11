import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { postTenantEnsure, type TenantDto } from "@/services/tenant-bff.service";

type TenantSettingsContextValue = {
  tenantId: string;
  tenant: TenantDto | null;
  loading: boolean;
  /** When false, hide subtitle / realtime transcribe controls for this tenant. */
  subtitlesEnabled: boolean;
  /** When true, show per-clip syndication UI (YouTube first). */
  syndicationYoutubeEnabled: boolean;
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
      if (q.get("youtubeConnected") === "1") {
        q.delete("youtubeConnected");
        const next = `${location.pathname}${q.toString() ? `?${q.toString()}` : ""}${location.hash}`;
        window.history.replaceState({}, "", next);
        void refresh();
      }
    } catch {
      /* ignore */
    }
  }, [location.search, location.pathname, location.hash, refresh]);

  const subtitlesEnabled = !tenantId || tenant?.subtitlesEnabled !== false;
  const syndicationYoutubeEnabled = Boolean(tenantId && tenant?.syndicationYoutubeEnabled === true);

  const value = useMemo(
    () => ({
      tenantId,
      tenant,
      loading,
      subtitlesEnabled,
      syndicationYoutubeEnabled,
      refresh,
    }),
    [tenantId, tenant, loading, subtitlesEnabled, syndicationYoutubeEnabled, refresh],
  );

  return <TenantSettingsContext.Provider value={value}>{children}</TenantSettingsContext.Provider>;
}

export function useTenantSettings(): TenantSettingsContextValue {
  const ctx = useContext(TenantSettingsContext);
  if (!ctx) throw new Error("useTenantSettings must be used within TenantSettingsProvider");
  return ctx;
}
