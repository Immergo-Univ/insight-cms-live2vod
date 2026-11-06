import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { useTenantSettings } from "@/providers/tenant-settings-provider";
import {
  fetchTenantSyndicationStatus,
  fetchTenantSyndicationYoutubeAuthUrl,
  postTenantSyndicationYoutubeMockAuthorize,
  fetchTenantSyndicationTwitterAuthUrl,
  postTenantSyndicationTwitterMockAuthorize,
  fetchTenantSyndicationFacebookAuthUrl,
  fetchTenantSyndicationFacebookPages,
  postTenantSyndicationFacebookSelectPage,
  postTenantSyndicationFacebookMockAuthorize,
  fetchTenantSyndicationInstagramAuthUrl,
  fetchTenantSyndicationInstagramAccounts,
  postTenantSyndicationInstagramSelectAccount,
  postTenantSyndicationInstagramMockAuthorize,
  fetchTenantSyndicationTiktokAuthUrl,
  postTenantSyndicationTiktokMockAuthorize,
  SyndicationDuplicateAccountError,
  type TenantSyndicationStatus,
} from "@/services/tenant-syndication.service";
import { loadAccountDefaults, saveAccountDefaults } from "@/services/syndication-defaults-store";
import {
  buildAccountCards,
  collectDefaults,
  SYNDICATION_PLATFORM_META,
  SYNDICATION_PLATFORM_ORDER,
  type SyndCard,
  type SyndField,
  type SyndicationAccountLike,
  type SyndicationPlatform,
} from "@/components/syndication/syndication-settings-model";
import { PlatformBadge } from "@/components/syndication/syndication-platform-badge";
import { SyndicationFieldControl } from "@/components/syndication/syndication-field-control";
import { SyndicationConnectModal } from "@/components/syndication/syndication-connect-modal";
import {
  SyndicationSelectTargetModal,
  type SelectTargetOption,
} from "@/components/syndication/syndication-select-target-modal";

type AccountStatus = "active" | "pending_selection";

type FlatAccount = SyndicationAccountLike & {
  key: string;
  status: AccountStatus;
  needsSelection: boolean;
  pendingAccountId?: string | null;
};

const MOCK_AUTHORIZE: Record<SyndicationPlatform, (tenantId: string) => Promise<unknown>> = {
  youtube: postTenantSyndicationYoutubeMockAuthorize,
  twitter: postTenantSyndicationTwitterMockAuthorize,
  facebook: postTenantSyndicationFacebookMockAuthorize,
  instagram: postTenantSyndicationInstagramMockAuthorize,
  tiktok: postTenantSyndicationTiktokMockAuthorize,
};

const AUTH_URL: Record<SyndicationPlatform, (tenantId: string) => Promise<string>> = {
  youtube: fetchTenantSyndicationYoutubeAuthUrl,
  twitter: fetchTenantSyndicationTwitterAuthUrl,
  facebook: fetchTenantSyndicationFacebookAuthUrl,
  instagram: fetchTenantSyndicationInstagramAuthUrl,
  tiktok: fetchTenantSyndicationTiktokAuthUrl,
};

const STATUS_STYLE: Record<AccountStatus, { label: string; color: string; bg: string }> = {
  active: { label: "Connected", color: "#1a8a5a", bg: "#e9f7ef" },
  pending_selection: { label: "Finish setup", color: "#b45309", bg: "#fff4e5" },
};

// Shared base styles mirrored from the HTML mockup.
const ROOT_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const CARD: CSSProperties = { background: "#ffffff", border: "1px solid #e6e9ee", borderRadius: 12 };
const BTN_PRIMARY: CSSProperties = {
  height: 42,
  padding: "0 22px",
  border: 0,
  borderRadius: 8,
  background: "#1f5ce0",
  color: "#ffffff",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};
const BTN_GHOST: CSSProperties = {
  height: 42,
  padding: "0 18px",
  border: "1px solid #c9d3e6",
  borderRadius: 8,
  background: "#ffffff",
  color: "#1f5ce0",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function SyndicationSettingsPage() {
  const location = useLocation();
  const {
    tenantId,
    syndicationYoutubeEnabled,
    syndicationTwitterEnabled,
    syndicationFacebookEnabled,
    syndicationInstagramEnabled,
    syndicationTiktokEnabled,
  } = useTenantSettings();

  const enabledPlatforms = useMemo<SyndicationPlatform[]>(() => {
    const flags: Record<SyndicationPlatform, boolean> = {
      youtube: syndicationYoutubeEnabled,
      facebook: syndicationFacebookEnabled,
      instagram: syndicationInstagramEnabled,
      twitter: syndicationTwitterEnabled,
      tiktok: syndicationTiktokEnabled,
    };
    return SYNDICATION_PLATFORM_ORDER.filter((p) => flags[p]);
  }, [
    syndicationYoutubeEnabled,
    syndicationTwitterEnabled,
    syndicationFacebookEnabled,
    syndicationInstagramEnabled,
    syndicationTiktokEnabled,
  ]);

  const [status, setStatus] = useState<TenantSyndicationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | SyndicationPlatform>("all");
  const [search, setSearch] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);

  const [selectOpen, setSelectOpen] = useState(false);
  const [selectBusy, setSelectBusy] = useState(false);
  const [selectLoading, setSelectLoading] = useState(false);
  const [selectOptions, setSelectOptions] = useState<SelectTargetOption[]>([]);
  const [selectChoiceId, setSelectChoiceId] = useState("");
  const [selectContext, setSelectContext] = useState<{
    platform: "facebook" | "instagram";
    pendingAccountId: string | null;
  } | null>(null);

  const loadStatus = useCallback(async () => {
    const id = tenantId.trim();
    if (!id) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const s = await fetchTenantSyndicationStatus(id);
      setStatus(s);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load syndication status");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const accounts = useMemo<FlatAccount[]>(() => {
    if (!status) return [];
    const out: FlatAccount[] = [];
    for (const platform of enabledPlatforms) {
      const branch = status[platform];
      const list = branch?.accounts ?? [];
      for (const acc of list) {
        out.push({
          key: `${platform}:${acc.id}`,
          id: acc.id,
          platform,
          displayName: acc.displayName,
          status: acc.status,
          needsSelection: acc.status === "pending_selection",
          pendingAccountId: branch?.pendingAccountId ?? null,
        });
      }
    }
    return out;
  }, [status, enabledPlatforms]);

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !accounts.some((a) => a.key === selectedKey)) {
      setSelectedKey(accounts[0].key);
    }
  }, [accounts, selectedKey]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.key === selectedKey) ?? null,
    [accounts, selectedKey],
  );

  const cards = useMemo(
    () => (selectedAccount ? buildAccountCards(selectedAccount) : { left: [], right: [] }),
    [selectedAccount],
  );

  useEffect(() => {
    if (!selectedAccount) {
      setDraft({});
      setDirty(false);
      return;
    }
    const base = collectDefaults([...cards.left, ...cards.right]);
    const stored = loadAccountDefaults(tenantId, selectedAccount.platform, selectedAccount.id);
    setDraft({ ...base, ...(stored ?? {}) });
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter !== "all" && a.platform !== filter) return false;
      if (!q) return true;
      return (a.displayName + " " + SYNDICATION_PLATFORM_META[a.platform].label).toLowerCase().includes(q);
    });
  }, [accounts, filter, search]);

  const handleAuthorize = useCallback(
    async (platform: SyndicationPlatform) => {
      const id = tenantId.trim();
      if (!id) return;
      setAuthBusy(true);
      try {
        const url = await AUTH_URL[platform](id);
        window.location.href = url;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not start sign-in");
        setAuthBusy(false);
      }
    },
    [tenantId],
  );

  const handleMockAuthorize = useCallback(
    async (platform: SyndicationPlatform) => {
      const id = tenantId.trim();
      if (!id) return;
      setAuthBusy(true);
      try {
        await MOCK_AUTHORIZE[platform](id);
        await loadStatus();
        setConnectOpen(false);
        toast.success(`${SYNDICATION_PLATFORM_META[platform].label} connected (mock)`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Mock authorize failed");
      } finally {
        setAuthBusy(false);
      }
    },
    [tenantId, loadStatus],
  );

  const openSelectTarget = useCallback(
    async (platform: "facebook" | "instagram", pendingAccountId: string | null) => {
      const id = tenantId.trim();
      if (!id) return;
      setSelectContext({ platform, pendingAccountId });
      setSelectChoiceId("");
      setSelectOptions([]);
      setSelectOpen(true);
      setSelectLoading(true);
      try {
        if (platform === "facebook") {
          const pages = await fetchTenantSyndicationFacebookPages(id, pendingAccountId ?? undefined);
          setSelectOptions(pages.map((p) => ({ id: p.id, name: p.name })));
          if (pages.length === 1) setSelectChoiceId(pages[0].id);
        } else {
          const igAccounts = await fetchTenantSyndicationInstagramAccounts(id, pendingAccountId ?? undefined);
          setSelectOptions(
            igAccounts.map((a) => ({
              id: a.id,
              name: a.username,
              detail: a.pageName ? `Linked page: ${a.pageName}` : undefined,
            })),
          );
          if (igAccounts.length === 1) setSelectChoiceId(igAccounts[0].id);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load options");
      } finally {
        setSelectLoading(false);
      }
    },
    [tenantId],
  );

  const confirmSelectTarget = useCallback(async () => {
    const id = tenantId.trim();
    if (!id || !selectContext || !selectChoiceId.trim()) return;
    setSelectBusy(true);
    try {
      if (selectContext.platform === "facebook") {
        await postTenantSyndicationFacebookSelectPage(
          id,
          selectChoiceId.trim(),
          selectContext.pendingAccountId ?? undefined,
        );
      } else {
        await postTenantSyndicationInstagramSelectAccount(
          id,
          selectChoiceId.trim(),
          selectContext.pendingAccountId ?? undefined,
        );
      }
      setSelectOpen(false);
      await loadStatus();
      toast.success("Account setup finished");
    } catch (e) {
      if (e instanceof SyndicationDuplicateAccountError) {
        toast.info(e.message);
      } else {
        toast.error(e instanceof Error ? e.message : "Failed to save selection");
      }
    } finally {
      setSelectBusy(false);
    }
  }, [tenantId, selectContext, selectChoiceId, loadStatus]);

  const updateField = useCallback((id: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [id]: value }));
    setDirty(true);
  }, []);

  const resetDraft = useCallback(() => {
    if (!selectedAccount) return;
    const base = collectDefaults([...cards.left, ...cards.right]);
    const stored = loadAccountDefaults(tenantId, selectedAccount.platform, selectedAccount.id);
    setDraft({ ...base, ...(stored ?? {}) });
    setDirty(false);
  }, [selectedAccount, cards, tenantId]);

  const handleSaveDefaults = useCallback(() => {
    if (!selectedAccount) return;
    saveAccountDefaults(tenantId, selectedAccount.platform, selectedAccount.id, draft);
    setDirty(false);
    toast.success("Default settings saved");
  }, [selectedAccount, tenantId, draft]);

  if (!tenantId.trim()) {
    return (
      <div style={{ minHeight: "100%", background: "#f6f7f9", fontFamily: ROOT_FONT, color: "#1f1e1d", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <p style={{ color: "#6b7079" }}>Missing tenant. Open this view from the CMS with a tenant selected.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100%", background: "#f6f7f9", color: "#1f1e1d", font: "14px/1.4 " + ROOT_FONT, display: "flex", flexDirection: "column" }}>
      {/* Breadcrumb + Connect account */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "20px 24px 6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, color: "#555b63" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2a9fd6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21v-9" />
            <path d="M12 12c0-4-2.5-6.5-6.5-6.5" />
            <path d="M12 12c0-4 2.5-6.5 6.5-6.5" />
            <path d="M3.5 7.5 5.5 5.5 7.5 7.5" />
            <path d="M16.5 7.5 18.5 5.5 20.5 7.5" />
          </svg>
          <span>Integrations</span>
          <span>/</span>
          <b style={{ color: "#2f3237", fontWeight: 500 }}>Social Media</b>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            onClick={() => setConnectOpen(true)}
            disabled={enabledPlatforms.length === 0}
            style={{
              height: 44,
              padding: "0 18px",
              border: 0,
              borderRadius: 8,
              background: "#1f5ce0",
              color: "#ffffff",
              font: "inherit",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: enabledPlatforms.length === 0 ? "not-allowed" : "pointer",
              opacity: enabledPlatforms.length === 0 ? 0.5 : 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Connect account
          </button>
        </div>
      </div>

      <p style={{ margin: 0, padding: "0 24px 14px", color: "#6b7079", fontSize: 14 }}>
        Connect each social or video account once and set the defaults its posts use. Editors can still change a single
        post in the clip's Syndication tab.
      </p>

      {enabledPlatforms.length === 0 ? (
        <div style={{ padding: "40px 24px", display: "flex", justifyContent: "center" }}>
          <p style={{ maxWidth: 420, textAlign: "center", color: "#6b7079" }}>
            No social networks are enabled for this tenant. An administrator can enable YouTube, Facebook, Instagram, X or
            TikTok in tenant settings.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: "0 24px 28px", alignItems: "flex-start" }}>
          {/* Left: connected accounts */}
          <aside aria-label="Connected accounts" style={{ ...CARD, flex: "0 1 380px", minWidth: 300, overflow: "hidden" }}>
            <div style={{ padding: "16px 16px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <b style={{ fontSize: 16, fontWeight: 600 }}>Connected accounts</b>
                <span style={{ color: "#6b7079", fontSize: 13 }}>{accounts.length} accounts</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #d5d9e0", borderRadius: 8, padding: "0 12px", height: 40 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7079" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search accounts"
                  aria-label="Search accounts"
                  style={{ border: 0, outline: 0, flex: 1, minWidth: 0, font: "inherit", fontSize: 14, background: "transparent", color: "#1f1e1d" }}
                />
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <FilterChip label="All" count={accounts.length} active={filter === "all"} onClick={() => setFilter("all")} />
                {enabledPlatforms.map((platform) => (
                  <FilterChip
                    key={platform}
                    label={SYNDICATION_PLATFORM_META[platform].shortLabel}
                    count={accounts.filter((a) => a.platform === platform).length}
                    active={filter === platform}
                    onClick={() => setFilter(platform)}
                  />
                ))}
              </div>
            </div>

            <div style={{ borderTop: "1px solid #eef0f3" }}>
              {loading && accounts.length === 0 ? (
                <p style={{ padding: "16px", color: "#6b7079", fontSize: 14 }}>Loading accounts…</p>
              ) : loadError ? (
                <p style={{ padding: "16px", color: "#b42328", fontSize: 14 }}>{loadError}</p>
              ) : filteredAccounts.length === 0 ? (
                <div style={{ padding: "40px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
                  <p style={{ color: "#6b7079", fontSize: 14, margin: 0 }}>No connected accounts yet.</p>
                  <button
                    type="button"
                    onClick={() => setConnectOpen(true)}
                    style={{ border: 0, background: "transparent", color: "#1f5ce0", font: "inherit", fontWeight: 600, cursor: "pointer" }}
                  >
                    Connect your first account
                  </button>
                </div>
              ) : (
                filteredAccounts.map((account) => (
                  <AccountRow
                    key={account.key}
                    account={account}
                    active={account.key === selectedKey}
                    onClick={() => setSelectedKey(account.key)}
                  />
                ))
              )}
            </div>
          </aside>

          {/* Right: account detail + defaults */}
          <section aria-label="Account settings" style={{ flex: "999 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            {!selectedAccount ? (
              <div style={{ ...CARD, padding: 40, textAlign: "center", color: "#6b7079" }}>
                Select an account to configure its default settings.
              </div>
            ) : (
              <AccountDetail
                account={selectedAccount}
                cards={cards}
                draft={draft}
                dirty={dirty}
                onFieldChange={updateField}
                onSave={handleSaveDefaults}
                onCancel={resetDraft}
                onReconnect={() => void handleAuthorize(selectedAccount.platform)}
                onFinishSetup={() =>
                  void openSelectTarget(
                    selectedAccount.platform as "facebook" | "instagram",
                    selectedAccount.pendingAccountId ?? null,
                  )
                }
                authBusy={authBusy}
              />
            )}
          </section>
        </div>
      )}

      <SyndicationConnectModal
        isOpen={connectOpen}
        onOpenChange={setConnectOpen}
        platforms={enabledPlatforms}
        authBusy={authBusy}
        onAuthorize={(platform) => void handleAuthorize(platform)}
        mockAvailable={{
          youtube: status?.youtube.mockAuthAvailable,
          facebook: status?.facebook.mockAuthAvailable,
          instagram: status?.instagram.mockAuthAvailable,
          twitter: status?.twitter.mockAuthAvailable,
          tiktok: status?.tiktok.mockAuthAvailable,
        }}
        onMockAuthorize={(platform) => void handleMockAuthorize(platform)}
      />

      <SyndicationSelectTargetModal
        isOpen={selectOpen}
        onOpenChange={setSelectOpen}
        title={selectContext?.platform === "instagram" ? "CHOOSE INSTAGRAM ACCOUNT" : "CHOOSE A FACEBOOK PAGE"}
        banner={
          selectContext?.platform === "instagram"
            ? "Signed in. Choose the account to add."
            : "Signed in to Facebook. Choose the page to add."
        }
        description={
          selectContext?.platform === "instagram"
            ? "Pick which Instagram account should receive syndicated videos. A linked page is added with its account."
            : "Pick which Facebook Page should receive syndicated videos. A linked Instagram account is added with its page."
        }
        options={selectOptions}
        loading={selectLoading}
        busy={selectBusy}
        selectedId={selectChoiceId}
        onSelect={setSelectChoiceId}
        onConfirm={() => void confirmSelectTarget()}
        confirmLabel={selectContext?.platform === "instagram" ? "Add account" : "Add page"}
        emptyLabel="No options found, or all available targets are already authorized."
      />
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 30,
        padding: "0 11px",
        borderRadius: 999,
        border: `1px solid ${active ? "#1f5ce0" : "#d5d9e0"}`,
        background: active ? "#1f5ce0" : "#ffffff",
        color: active ? "#ffffff" : "#2f3237",
        font: "inherit",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label} <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}

function AccountAvatar({ account, size }: { account: FlatAccount; size: number }) {
  const badge = Math.round(size * 0.45);
  return (
    <span style={{ position: "relative", flex: "none", width: size, height: size }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "#0b2a6b",
          color: "#ffffff",
          fontSize: Math.round(size * 0.3),
          fontWeight: 700,
          fontStyle: "italic",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {initials(account.displayName)}
      </span>
      <span
        style={{
          position: "absolute",
          right: -4,
          bottom: -3,
          minWidth: badge,
          height: badge,
          padding: "0 3px",
          boxSizing: "border-box",
          borderRadius: badge / 2,
          border: "2px solid #ffffff",
          background: SYNDICATION_PLATFORM_META[account.platform].iconBg,
          color: "#ffffff",
          fontSize: Math.max(8, Math.round(size * 0.2)),
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
      >
        {SYNDICATION_PLATFORM_META[account.platform].glyph}
      </span>
    </span>
  );
}

function AccountRow({
  account,
  active,
  onClick,
}: {
  account: FlatAccount;
  active: boolean;
  onClick: () => void;
}) {
  const meta = SYNDICATION_PLATFORM_META[account.platform];
  const st = STATUS_STYLE[account.status];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        border: 0,
        borderBottom: "1px solid #eef0f3",
        background: active ? "#e3e9f5" : "#ffffff",
        boxShadow: active ? "inset 4px 0 0 #1f5ce0" : "none",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        cursor: "pointer",
      }}
    >
      <AccountAvatar account={account} size={40} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {account.displayName}
        </span>
        <span style={{ fontSize: 12, color: "#6b7079" }}>{meta.label}</span>
        <span style={{ fontSize: 12, color: st.color, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.color }} />
          {st.label}
        </span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a93a3" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </button>
  );
}

function AccountDetail({
  account,
  cards,
  draft,
  dirty,
  onFieldChange,
  onSave,
  onCancel,
  onReconnect,
  onFinishSetup,
  authBusy,
}: {
  account: FlatAccount;
  cards: { left: SyndCard[]; right: SyndCard[] };
  draft: Record<string, unknown>;
  dirty: boolean;
  onFieldChange: (id: string, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
  onReconnect: () => void;
  onFinishSetup: () => void;
  authBusy: boolean;
}) {
  const meta = SYNDICATION_PLATFORM_META[account.platform];
  const st = STATUS_STYLE[account.status];
  const canFinishSetup =
    account.needsSelection && (account.platform === "facebook" || account.platform === "instagram");

  return (
    <>
      {/* Status header */}
      <div style={{ ...CARD, padding: "20px 22px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        <AccountAvatar account={account} size={56} />
        <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600 }}>{account.displayName}</h1>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 24,
                padding: "0 10px",
                borderRadius: 999,
                background: st.bg,
                color: st.color,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.color }} />
              {st.label}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, color: "#6b7079", fontSize: 13 }}>
            <PlatformBadge platform={account.platform} size={22} fontSize={10} />
            <span>{meta.label}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            disabled
            title="Coming soon — backend endpoint pending"
            style={{ height: 40, padding: "0 16px", border: "1px solid #c9d3e6", borderRadius: 8, background: "#ffffff", color: "#1f5ce0", font: "inherit", fontWeight: 600, cursor: "not-allowed", opacity: 0.55 }}
          >
            Send test post
          </button>
          <button
            type="button"
            onClick={onReconnect}
            disabled={authBusy}
            style={{ height: 40, padding: "0 16px", border: "1px solid #c9d3e6", borderRadius: 8, background: "#ffffff", color: "#1f5ce0", font: "inherit", fontWeight: 600, cursor: "pointer", opacity: authBusy ? 0.5 : 1 }}
          >
            Reconnect
          </button>
          <button
            type="button"
            disabled
            title="Coming soon — backend endpoint pending"
            style={{ height: 40, padding: "0 16px", border: "1px solid #f0c9cb", borderRadius: 8, background: "#ffffff", color: "#b42328", font: "inherit", fontWeight: 600, cursor: "not-allowed", opacity: 0.55 }}
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Pending selection alert */}
      {canFinishSetup ? (
        <div role="alert" style={{ background: "#fff4e5", border: "1px solid #f3c58a", borderRadius: 12, padding: "14px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3 2 20h20L12 3Z" />
            <path d="M12 10v4M12 17.5v.5" />
          </svg>
          <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 2 }}>
            <b style={{ color: "#7a3e06" }}>Finish connecting this account</b>
            <span style={{ color: "#7a3e06", fontSize: 13 }}>
              {account.platform === "instagram"
                ? "Choose which Instagram account should receive syndicated videos."
                : "Choose which Facebook Page should receive syndicated videos."}
            </span>
          </div>
          <button
            type="button"
            onClick={onFinishSetup}
            style={{ height: 40, padding: "0 18px", border: 0, borderRadius: 8, background: "#e8820c", color: "#ffffff", font: "inherit", fontWeight: 600, cursor: "pointer" }}
          >
            {account.platform === "instagram" ? "Choose account" : "Choose Page"}
          </button>
        </div>
      ) : null}

      {/* Default settings cards (two columns) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {cards.left.map((card) => (
            <SettingsCard key={card.id} card={card} draft={draft} onFieldChange={onFieldChange} />
          ))}
        </div>
        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {cards.right.map((card) => (
            <SettingsCard key={card.id} card={card} draft={draft} onFieldChange={onFieldChange} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ ...CARD, padding: "14px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <span style={{ flex: 1, minWidth: 260, fontSize: 13, color: "#6b7079" }}>
          Changes apply to new posts. Posts that are already scheduled keep the settings they were made with.
        </span>
        <button type="button" onClick={onCancel} disabled={!dirty} style={{ ...BTN_GHOST, opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "not-allowed" }}>
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={!dirty} style={{ ...BTN_PRIMARY, opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "not-allowed" }}>
          Save changes
        </button>
      </div>
    </>
  );
}

function SettingsCard({
  card,
  draft,
  onFieldChange,
}: {
  card: SyndCard;
  draft: Record<string, unknown>;
  onFieldChange: (id: string, value: unknown) => void;
}) {
  return (
    <div style={{ ...CARD, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #eef0f3" }}>
        {card.platform ? <PlatformBadge platform={card.platform} size={24} fontSize={10} /> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{card.title}</h2>
          {card.subtitle ? <span style={{ fontSize: 12, color: "#6b7079" }}>{card.subtitle}</span> : null}
        </div>
      </div>
      <div style={{ padding: "4px 20px 10px" }}>
        {card.fields.map((field, i) => (
          <FieldRow
            key={field.kind === "info" ? `${card.id}-info-${i}` : field.id}
            field={field}
            last={i === card.fields.length - 1}
            value={field.kind === "info" ? undefined : draft[field.id]}
            onChange={(value) => {
              if (field.kind !== "info") onFieldChange(field.id, value);
            }}
          />
        ))}
      </div>
      {card.note ? <p style={{ margin: "10px 20px 14px", fontSize: 12, color: "#6b7079" }}>{card.note}</p> : null}
    </div>
  );
}

function FieldRow({
  field,
  last,
  value,
  onChange,
}: {
  field: SyndField;
  last: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(150px, 210px) minmax(0, 1fr)",
        gap: "6px 18px",
        alignItems: "center",
        padding: "11px 0",
        borderBottom: last ? "0" : "1px solid #eef0f3",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{field.label}</span>
        {field.help ? (
          <span style={{ fontSize: 12, color: "#6b7079", lineHeight: 1.4 }}>{field.help}</span>
        ) : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <SyndicationFieldControl field={field} value={value} onChange={onChange} />
      </div>
    </div>
  );
}
