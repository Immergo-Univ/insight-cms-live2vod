import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Image01 } from "@untitledui/icons";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { Tabs } from "@/components/application/tabs/tabs";
import { CloseButton } from "@/components/base/buttons/close-button";
import { AppSelect } from "@/components/base/select/app-select";
import { Toggle } from "@/components/base/toggle/toggle";
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
  fetchTenantSyndicationTiktokCreatorInfo,
  postTenantSyndicationTiktokMockAuthorize,
  SyndicationDuplicateAccountError,
} from "@/services/tenant-syndication.service";
import type {
  FacebookPageOption,
  InstagramAccountOption,
  SyndicationAccountSummary,
  TiktokCreatorInfo,
} from "@/services/tenant-syndication.service";
import { SyndicationAccountsPanel, SyndicationOAuthBlock } from "@/components/editor/syndication-accounts-panel";
import type {
  EditorClipSyndication,
  EditorClipFacebookSyndication,
  EditorClipInstagramSyndication,
  EditorClipTiktokSyndication,
  EditorClipTwitterSyndication,
  EditorClipYoutubeSyndication,
  EditorClipYoutubeSyndicationOptions,
  EditorInstagramMediaType,
  EditorYoutubePrivacyStatus,
} from "@/types/editor";
import type { EditorSubClip } from "@/types/editor";
import { normalizeEditorClipTagsList } from "@/types/editor";
import { cx } from "@/utils/cx";
import { buildThumbnailUrl } from "./editor-constants";
import { formatTime } from "./editor-timeline";

type SyndicationUploadEntry = {
  state?: string;
  message?: string;
  error?: string;
  watchUrl?: string;
  tweetUrl?: string;
  permalinkUrl?: string;
  shareUrl?: string;
};

type SyndicationUploadBranch = {
  upload?: SyndicationUploadEntry;
  uploads?: Record<string, SyndicationUploadEntry>;
};

function collectSyndicationUploadEntries(
  branch: SyndicationUploadBranch,
): Array<{ accountId: string | null; upload: SyndicationUploadEntry }> {
  if (branch.uploads && Object.keys(branch.uploads).length > 0) {
    return Object.entries(branch.uploads).map(([accountId, upload]) => ({ accountId, upload }));
  }
  if (branch.upload?.state) {
    return [{ accountId: null, upload: branch.upload }];
  }
  return [];
}

function syndicationUploadTabSuffix(branch: SyndicationUploadBranch, accountCount: number): string {
  const entries = collectSyndicationUploadEntries(branch);
  if (!entries.length) return "";
  const total = Math.max(accountCount, entries.length);
  const published = entries.filter((e) => e.upload.state === "published").length;
  const failed = entries.filter((e) => e.upload.state === "failed").length;
  if (failed > 0) return ` (${published}/${total}, ${failed} failed)`;
  if (published > 0) return ` (${published}/${total} published)`;
  const active = entries.filter((e) => e.upload.state === "uploading" || e.upload.state === "pending").length;
  if (active > 0) return ` (${active}/${total} in progress)`;
  return "";
}

function SyndicationUploadStatusBlock({
  branch,
  accounts,
  linkLabel,
  linkUrlKey,
}: {
  branch: SyndicationUploadBranch;
  accounts: SyndicationAccountSummary[];
  linkLabel: string;
  linkUrlKey: "watchUrl" | "tweetUrl" | "permalinkUrl" | "shareUrl";
}) {
  const entries = collectSyndicationUploadEntries(branch);
  if (!entries.length) return null;

  const accountLabel = (accountId: string | null) => {
    if (!accountId) return "Account";
    const match = accounts.find((a) => a.id === accountId);
    return match?.displayName || accountId.slice(0, 8);
  };

  const total = Math.max(accounts.length, entries.length);
  const published = entries.filter((e) => e.upload.state === "published").length;
  const showSummary = entries.length > 1 || accounts.length > 1;

  return (
    <div className="flex flex-col gap-2">
      {showSummary ? (
        <p className="text-xs font-medium text-secondary">
          Upload progress: {published}/{total} published
        </p>
      ) : null}
      {entries.map(({ accountId, upload }) => {
        const linkUrl = upload[linkUrlKey];
        return (
          <p
            key={accountId || "legacy"}
            className="rounded-md border border-secondary bg-secondary px-2 py-2 text-xs text-secondary"
          >
            {entries.length > 1 || accountId ? (
              <span className="mb-0.5 block font-medium text-primary">{accountLabel(accountId)}</span>
            ) : null}
            Upload status: <strong className="text-primary">{upload.state}</strong>
            {upload.message ? ` — ${upload.message}` : ""}
            {linkUrl ? (
              <>
                {" "}
                <a href={linkUrl} target="_blank" rel="noreferrer" className="text-brand-secondary underline">
                  {linkLabel}
                </a>
              </>
            ) : null}
            {upload.error ? <span className="mt-1 block text-error-primary">{upload.error}</span> : null}
          </p>
        );
      })}
    </div>
  );
}

function clipMetadataDefaults(clip: EditorSubClip) {
  const title = clip.title?.trim() || `Clip ${clip.order}`;
  const description = clip.description?.trim() || "";
  const tags = normalizeEditorClipTagsList(clip.tags ?? []);
  const combinedText = [title, description].filter(Boolean).join("\n\n");
  return { title, description, tags, combinedText };
}

function defaultYoutubeBranch(
  clip: EditorSubClip,
  defaultEnabled: boolean,
): EditorClipYoutubeSyndication {
  const existing = clip.syndication?.youtube;
  const defaults = clipMetadataDefaults(clip);
  return {
    enabled: existing?.enabled === true || (!existing && defaultEnabled),
    options: {
      privacyStatus: (existing?.options?.privacyStatus as EditorYoutubePrivacyStatus) || "private",
      categoryId: existing?.options?.categoryId != null ? String(existing.options.categoryId) : "22",
      embeddable: existing?.options?.embeddable !== false,
      license: existing?.options?.license === "creativeCommon" ? "creativeCommon" : "youtube",
      publicStatsViewable: existing?.options?.publicStatsViewable !== false,
      selfDeclaredMadeForKids: Boolean(existing?.options?.selfDeclaredMadeForKids),
      notifySubscribers: Boolean(existing?.options?.notifySubscribers),
      titleOverride: existing?.options?.titleOverride?.trim() || defaults.title,
      descriptionOverride: existing?.options?.descriptionOverride?.trim() || defaults.description,
      tagsExtra: existing?.options?.tagsExtra?.length ? [...existing.options.tagsExtra] : [...defaults.tags],
      defaultLanguage: existing?.options?.defaultLanguage ?? "",
      defaultAudioLanguage: existing?.options?.defaultAudioLanguage ?? "",
    },
    upload: existing?.upload ? { ...existing.upload } : undefined,
    uploads: existing?.uploads ? { ...existing.uploads } : undefined,
  };
}

function defaultTwitterBranch(
  clip: EditorSubClip,
  defaultEnabled: boolean,
): EditorClipTwitterSyndication {
  const existing = clip.syndication?.twitter;
  const defaults = clipMetadataDefaults(clip);
  return {
    enabled: existing?.enabled === true || (!existing && defaultEnabled),
    options: {
      textOverride: existing?.options?.textOverride?.trim() || defaults.combinedText || defaults.title,
    },
    upload: existing?.upload ? { ...existing.upload } : undefined,
    uploads: existing?.uploads ? { ...existing.uploads } : undefined,
  };
}

function defaultFacebookBranch(
  clip: EditorSubClip,
  defaultEnabled: boolean,
): EditorClipFacebookSyndication {
  const existing = clip.syndication?.facebook;
  const defaults = clipMetadataDefaults(clip);
  return {
    enabled: existing?.enabled === true || (!existing && defaultEnabled),
    options: {
      titleOverride: existing?.options?.titleOverride?.trim() || defaults.title,
      descriptionOverride: existing?.options?.descriptionOverride?.trim() || defaults.description,
    },
    upload: existing?.upload ? { ...existing.upload } : undefined,
    uploads: existing?.uploads ? { ...existing.uploads } : undefined,
  };
}

function defaultInstagramBranch(
  clip: EditorSubClip,
  defaultEnabled: boolean,
): EditorClipInstagramSyndication {
  const existing = clip.syndication?.instagram;
  const mediaTypeRaw = existing?.options?.mediaType;
  const mediaType: EditorInstagramMediaType = mediaTypeRaw === "feed" ? "feed" : "reels";
  const defaults = clipMetadataDefaults(clip);
  return {
    enabled: existing?.enabled === true || (!existing && defaultEnabled),
    options: {
      captionOverride: existing?.options?.captionOverride?.trim() || defaults.combinedText || defaults.title,
      mediaType,
    },
    upload: existing?.upload ? { ...existing.upload } : undefined,
    uploads: existing?.uploads ? { ...existing.uploads } : undefined,
  };
}

function defaultTiktokBranch(
  clip: EditorSubClip,
  defaultEnabled: boolean,
): EditorClipTiktokSyndication {
  const existing = clip.syndication?.tiktok;
  const defaults = clipMetadataDefaults(clip);
  return {
    enabled: existing?.enabled === true || (!existing && defaultEnabled),
    options: {
      captionOverride: existing?.options?.captionOverride?.trim() || defaults.combinedText || defaults.title,
      privacyLevel: existing?.options?.privacyLevel ?? "",
      disableDuet: existing?.options?.disableDuet === true,
      disableComment: existing?.options?.disableComment === true,
      disableStitch: existing?.options?.disableStitch === true,
      brandContentToggle: existing?.options?.brandContentToggle === true,
      brandOrganicToggle: existing?.options?.brandOrganicToggle === true,
    },
    upload: existing?.upload ? { ...existing.upload } : undefined,
    uploads: existing?.uploads ? { ...existing.uploads } : undefined,
  };
}

interface EditorSyndicationModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  clip: EditorSubClip | null;
  clipUrl: string;
  channelId: string;
  readOnly?: boolean;
  syndicationYoutubeEnabled?: boolean;
  syndicationYoutubeDefaultEnabled?: boolean;
  syndicationTwitterEnabled?: boolean;
  syndicationTwitterDefaultEnabled?: boolean;
  syndicationFacebookEnabled?: boolean;
  syndicationFacebookDefaultEnabled?: boolean;
  syndicationInstagramEnabled?: boolean;
  syndicationInstagramDefaultEnabled?: boolean;
  syndicationTiktokEnabled?: boolean;
  syndicationTiktokDefaultEnabled?: boolean;
  onSave?: (clipId: string, syndication: EditorClipSyndication | undefined) => void;
}

export function EditorSyndicationModal({
  isOpen,
  onOpenChange,
  tenantId,
  clip,
  clipUrl,
  channelId,
  readOnly = false,
  syndicationYoutubeEnabled = false,
  syndicationYoutubeDefaultEnabled = false,
  syndicationTwitterEnabled = false,
  syndicationTwitterDefaultEnabled = false,
  syndicationFacebookEnabled = false,
  syndicationFacebookDefaultEnabled = false,
  syndicationInstagramEnabled = false,
  syndicationInstagramDefaultEnabled = false,
  syndicationTiktokEnabled = false,
  syndicationTiktokDefaultEnabled = false,
  onSave,
}: EditorSyndicationModalProps) {
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [youtubeAccounts, setYoutubeAccounts] = useState<SyndicationAccountSummary[]>([]);
  const [twitterAccounts, setTwitterAccounts] = useState<SyndicationAccountSummary[]>([]);
  const [facebookAccounts, setFacebookAccounts] = useState<SyndicationAccountSummary[]>([]);
  const [instagramAccounts, setInstagramAccounts] = useState<SyndicationAccountSummary[]>([]);
  const [tiktokAccounts, setTiktokAccounts] = useState<SyndicationAccountSummary[]>([]);
  const [facebookPendingAccountId, setFacebookPendingAccountId] = useState<string | null>(null);
  const [instagramPendingAccountId, setInstagramPendingAccountId] = useState<string | null>(null);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [twitterConnected, setTwitterConnected] = useState(false);
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [facebookPageSelected, setFacebookPageSelected] = useState(false);
  const [youtubeMockAuthAvailable, setYoutubeMockAuthAvailable] = useState(false);
  const [twitterMockAuthAvailable, setTwitterMockAuthAvailable] = useState(false);
  const [facebookMockAuthAvailable, setFacebookMockAuthAvailable] = useState(false);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [instagramAccountSelected, setInstagramAccountSelected] = useState(false);
  const [instagramMockAuthAvailable, setInstagramMockAuthAvailable] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [facebookPages, setFacebookPages] = useState<FacebookPageOption[]>([]);
  const [instagramPickerAccounts, setInstagramPickerAccounts] = useState<InstagramAccountOption[]>([]);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selectedIgAccountId, setSelectedIgAccountId] = useState("");
  const [ytDraft, setYtDraft] = useState<EditorClipYoutubeSyndication>(() =>
    clip ? defaultYoutubeBranch(clip, syndicationYoutubeDefaultEnabled) : { enabled: false, options: {} },
  );
  const [twDraft, setTwDraft] = useState<EditorClipTwitterSyndication>(() =>
    clip ? defaultTwitterBranch(clip, syndicationTwitterDefaultEnabled) : { enabled: false, options: {} },
  );
  const [fbDraft, setFbDraft] = useState<EditorClipFacebookSyndication>(() =>
    clip ? defaultFacebookBranch(clip, syndicationFacebookDefaultEnabled) : { enabled: false, options: {} },
  );
  const [igDraft, setIgDraft] = useState<EditorClipInstagramSyndication>(() =>
    clip ? defaultInstagramBranch(clip, syndicationInstagramDefaultEnabled) : { enabled: false, options: { mediaType: "reels" } },
  );
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [tiktokMockAuthAvailable, setTiktokMockAuthAvailable] = useState(false);
  const [tiktokCreatorInfo, setTiktokCreatorInfo] = useState<TiktokCreatorInfo | null>(null);
  const [creatorInfoBusy, setCreatorInfoBusy] = useState(false);
  const [ttDraft, setTtDraft] = useState<EditorClipTiktokSyndication>(() =>
    clip ? defaultTiktokBranch(clip, syndicationTiktokDefaultEnabled) : { enabled: false, options: {} },
  );
  const [platformLimits, setPlatformLimits] = useState<
    Record<string, { maxAccounts: number; accountCount: number; canAddAccount: boolean }>
  >({});

  const loadStatus = useCallback(async () => {
    const id = tenantId.trim();
    if (!id) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await fetchTenantSyndicationStatus(id);
      setYoutubeConnected(s.youtube.connected);
      setYoutubeAccounts(s.youtube.accounts ?? []);
      setTwitterConnected(s.twitter.connected);
      setTwitterAccounts(s.twitter.accounts ?? []);
      setFacebookConnected(s.facebook.connected);
      setFacebookAccounts(s.facebook.accounts ?? []);
      setFacebookPageSelected(s.facebook.pageSelected);
      setFacebookPendingAccountId(s.facebook.pendingAccountId ?? null);
      setYoutubeMockAuthAvailable(!!s.youtube.mockAuthAvailable);
      setTwitterMockAuthAvailable(!!s.twitter.mockAuthAvailable);
      setFacebookMockAuthAvailable(!!s.facebook.mockAuthAvailable);
      setInstagramConnected(s.instagram.connected);
      setInstagramAccounts(s.instagram.accounts ?? []);
      setInstagramAccountSelected(s.instagram.accountSelected);
      setInstagramPendingAccountId(s.instagram.pendingAccountId ?? null);
      setInstagramMockAuthAvailable(!!s.instagram.mockAuthAvailable);
      setTiktokConnected(s.tiktok.connected);
      setTiktokAccounts(s.tiktok.accounts ?? []);
      setTiktokMockAuthAvailable(!!s.tiktok.mockAuthAvailable);
      setPlatformLimits({
        youtube: {
          maxAccounts: s.youtube.maxAccounts ?? 5,
          accountCount: s.youtube.accountCount ?? (s.youtube.accounts?.length ?? 0),
          canAddAccount: s.youtube.canAddAccount !== false,
        },
        twitter: {
          maxAccounts: s.twitter.maxAccounts ?? 5,
          accountCount: s.twitter.accountCount ?? (s.twitter.accounts?.length ?? 0),
          canAddAccount: s.twitter.canAddAccount !== false,
        },
        facebook: {
          maxAccounts: s.facebook.maxAccounts ?? 5,
          accountCount: s.facebook.accountCount ?? (s.facebook.accounts?.length ?? 0),
          canAddAccount: s.facebook.canAddAccount !== false,
        },
        instagram: {
          maxAccounts: s.instagram.maxAccounts ?? 5,
          accountCount: s.instagram.accountCount ?? (s.instagram.accounts?.length ?? 0),
          canAddAccount: s.instagram.canAddAccount !== false,
        },
        tiktok: {
          maxAccounts: s.tiktok.maxAccounts ?? 5,
          accountCount: s.tiktok.accountCount ?? (s.tiktok.accounts?.length ?? 0),
          canAddAccount: s.tiktok.canAddAccount !== false,
        },
      });
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to load syndication status");
      setYoutubeConnected(false);
      setTwitterConnected(false);
      setFacebookConnected(false);
      setYoutubeAccounts([]);
      setTwitterAccounts([]);
      setFacebookAccounts([]);
      setInstagramAccounts([]);
      setTiktokAccounts([]);
      setFacebookPendingAccountId(null);
      setInstagramPendingAccountId(null);
      setFacebookPageSelected(false);
      setInstagramConnected(false);
      setInstagramAccountSelected(false);
      setYoutubeMockAuthAvailable(false);
      setTwitterMockAuthAvailable(false);
      setFacebookMockAuthAvailable(false);
      setInstagramMockAuthAvailable(false);
      setTiktokConnected(false);
      setTiktokMockAuthAvailable(false);
    } finally {
      setStatusLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!isOpen || !tenantId.trim()) return;
    void loadStatus();
  }, [isOpen, tenantId, loadStatus]);

  useEffect(() => {
    if (isOpen && clip) {
      setYtDraft(defaultYoutubeBranch(clip, syndicationYoutubeDefaultEnabled));
      setTwDraft(defaultTwitterBranch(clip, syndicationTwitterDefaultEnabled));
      setFbDraft(defaultFacebookBranch(clip, syndicationFacebookDefaultEnabled));
      setIgDraft(defaultInstagramBranch(clip, syndicationInstagramDefaultEnabled));
      setTtDraft(defaultTiktokBranch(clip, syndicationTiktokDefaultEnabled));
    }
  }, [
    isOpen,
    clip?.id,
    clip?.syndication,
    clip?.title,
    clip?.description,
    clip?.tags,
    syndicationYoutubeDefaultEnabled,
    syndicationTwitterDefaultEnabled,
    syndicationFacebookDefaultEnabled,
    syndicationInstagramDefaultEnabled,
    syndicationTiktokDefaultEnabled,
  ]);

  const loadTiktokCreatorInfo = useCallback(async () => {
    const id = tenantId.trim();
    if (!id || tiktokAccounts.length === 0) return;
    setCreatorInfoBusy(true);
    setStatusError(null);
    try {
      const info = await fetchTenantSyndicationTiktokCreatorInfo(id);
      setTiktokCreatorInfo(info);
      const opts = Array.isArray(info.privacy_level_options) ? info.privacy_level_options : [];
      if (opts.length && !ttDraft.options.privacyLevel) {
        const preferred = opts.includes("SELF_ONLY") ? "SELF_ONLY" : opts[0];
        setTtDraft((d) => ({
          ...d,
          options: { ...d.options, privacyLevel: preferred },
        }));
      }
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to load TikTok creator info");
      setTiktokCreatorInfo(null);
    } finally {
      setCreatorInfoBusy(false);
    }
  }, [tenantId, tiktokAccounts.length, ttDraft.options.privacyLevel]);

  useEffect(() => {
    if (!isOpen || tiktokAccounts.length === 0) return;
    void loadTiktokCreatorInfo();
  }, [isOpen, tiktokAccounts.length, loadTiktokCreatorInfo]);

  const loadFacebookPages = useCallback(async () => {
    const id = tenantId.trim();
    const pendingId = facebookPendingAccountId?.trim();
    if (!id || !pendingId) return;
    setPageBusy(true);
    setStatusError(null);
    try {
      const pages = await fetchTenantSyndicationFacebookPages(id, pendingId);
      setFacebookPages(pages);
      if (pages.length === 1) setSelectedPageId(pages[0].id);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to load Facebook Pages");
      setFacebookPages([]);
    } finally {
      setPageBusy(false);
    }
  }, [tenantId, facebookPendingAccountId]);

  useEffect(() => {
    if (!isOpen || !facebookPendingAccountId) return;
    void loadFacebookPages();
  }, [isOpen, facebookPendingAccountId, loadFacebookPages]);

  const loadInstagramAccounts = useCallback(async () => {
    const id = tenantId.trim();
    const pendingId = instagramPendingAccountId?.trim();
    if (!id || !pendingId) return;
    setPageBusy(true);
    setStatusError(null);
    try {
      const accounts = await fetchTenantSyndicationInstagramAccounts(id, pendingId);
      setInstagramPickerAccounts(accounts);
      if (accounts.length === 1) setSelectedIgAccountId(accounts[0].id);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to load Instagram accounts");
      setInstagramPickerAccounts([]);
    } finally {
      setPageBusy(false);
    }
  }, [tenantId, instagramPendingAccountId]);

  useEffect(() => {
    if (!isOpen || !instagramPendingAccountId) return;
    void loadInstagramAccounts();
  }, [isOpen, instagramPendingAccountId, loadInstagramAccounts]);

  const handleStartOAuth = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      const url = await fetchTenantSyndicationYoutubeAuthUrl(tenantId.trim());
      window.location.href = url;
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Could not start Google sign-in");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly]);

  const handleMockAuthorizeYoutube = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      await postTenantSyndicationYoutubeMockAuthorize(tenantId.trim());
      await loadStatus();
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Authorization failed");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly, loadStatus]);

  const handleStartTwitterOAuth = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      const url = await fetchTenantSyndicationTwitterAuthUrl(tenantId.trim());
      window.location.href = url;
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Could not start X sign-in");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly]);

  const handleMockAuthorizeTwitter = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      await postTenantSyndicationTwitterMockAuthorize(tenantId.trim());
      await loadStatus();
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Authorization failed");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly, loadStatus]);

  const handleStartFacebookOAuth = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      const url = await fetchTenantSyndicationFacebookAuthUrl(tenantId.trim());
      window.location.href = url;
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Could not start Facebook sign-in");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly]);

  const handleMockAuthorizeFacebook = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      await postTenantSyndicationFacebookMockAuthorize(tenantId.trim());
      await loadStatus();
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Authorization failed");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly, loadStatus]);

  const handleSaveFacebookPage = useCallback(async () => {
    if (readOnly || !tenantId.trim() || !selectedPageId.trim()) return;
    setPageBusy(true);
    setStatusError(null);
    try {
      const s = await postTenantSyndicationFacebookSelectPage(
        tenantId.trim(),
        selectedPageId.trim(),
        facebookPendingAccountId ?? undefined,
      );
      setFacebookPageSelected(s.facebook.pageSelected);
      setFacebookAccounts(s.facebook.accounts ?? []);
      setFacebookPendingAccountId(s.facebook.pendingAccountId ?? null);
      setSelectedPageId("");
      setFacebookPages([]);
    } catch (e) {
      if (e instanceof SyndicationDuplicateAccountError) {
        toast.info(e.message);
        return;
      }
      setStatusError(e instanceof Error ? e.message : "Failed to save Facebook Page");
    } finally {
      setPageBusy(false);
    }
  }, [tenantId, readOnly, selectedPageId, facebookPendingAccountId]);

  const handleStartInstagramOAuth = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      const url = await fetchTenantSyndicationInstagramAuthUrl(tenantId.trim());
      window.location.href = url;
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Could not start Instagram sign-in");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly]);

  const handleMockAuthorizeInstagram = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      await postTenantSyndicationInstagramMockAuthorize(tenantId.trim());
      await loadStatus();
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Mock authorize failed");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly, loadStatus]);

  const handleSaveInstagramAccount = useCallback(async () => {
    if (readOnly || !tenantId.trim() || !selectedIgAccountId.trim()) return;
    setPageBusy(true);
    setStatusError(null);
    try {
      const s = await postTenantSyndicationInstagramSelectAccount(
        tenantId.trim(),
        selectedIgAccountId.trim(),
        instagramPendingAccountId ?? undefined,
      );
      setInstagramAccountSelected(s.instagram.accountSelected);
      setInstagramAccounts(s.instagram.accounts ?? []);
      setInstagramPendingAccountId(s.instagram.pendingAccountId ?? null);
      setSelectedIgAccountId("");
      setInstagramPickerAccounts([]);
    } catch (e) {
      if (e instanceof SyndicationDuplicateAccountError) {
        toast.info(e.message);
        return;
      }
      setStatusError(e instanceof Error ? e.message : "Failed to save Instagram account");
    } finally {
      setPageBusy(false);
    }
  }, [tenantId, readOnly, selectedIgAccountId, instagramPendingAccountId]);

  const handleStartTiktokOAuth = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      const url = await fetchTenantSyndicationTiktokAuthUrl(tenantId.trim());
      window.location.href = url;
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Could not start TikTok sign-in");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly]);

  const handleMockAuthorizeTiktok = useCallback(async () => {
    if (readOnly || !tenantId.trim()) return;
    setAuthBusy(true);
    setStatusError(null);
    try {
      await postTenantSyndicationTiktokMockAuthorize(tenantId.trim());
      await loadStatus();
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Mock authorize failed");
    } finally {
      setAuthBusy(false);
    }
  }, [tenantId, readOnly, loadStatus]);

  const setOpt = useCallback((patch: Partial<EditorClipYoutubeSyndicationOptions>) => {
    setYtDraft((d) => ({ ...d, options: { ...d.options, ...patch } }));
  }, []);

  const handleSave = useCallback(() => {
    if (!clip || readOnly || !onSave) return;
    const next: EditorClipSyndication = {};
    if (syndicationYoutubeEnabled && youtubeConnected && ytDraft.enabled) {
      next.youtube = {
        enabled: true,
        options: {
          ...ytDraft.options,
          titleOverride: ytDraft.options.titleOverride?.trim() || undefined,
          descriptionOverride: ytDraft.options.descriptionOverride?.trim() || undefined,
          tagsExtra: ytDraft.options.tagsExtra?.length
            ? normalizeEditorClipTagsList(ytDraft.options.tagsExtra)
            : undefined,
          categoryId: ytDraft.options.categoryId?.trim() || "22",
          defaultLanguage: ytDraft.options.defaultLanguage?.trim() || undefined,
          defaultAudioLanguage: ytDraft.options.defaultAudioLanguage?.trim() || undefined,
        },
        upload: ytDraft.upload,
      };
    }
    if (syndicationTwitterEnabled && twitterConnected && twDraft.enabled) {
      next.twitter = {
        enabled: true,
        options: {
          textOverride: twDraft.options.textOverride?.trim() || undefined,
        },
        upload: twDraft.upload,
      };
    }
    if (syndicationFacebookEnabled && facebookConnected && facebookPageSelected && fbDraft.enabled) {
      next.facebook = {
        enabled: true,
        options: {
          titleOverride: fbDraft.options.titleOverride?.trim() || undefined,
          descriptionOverride: fbDraft.options.descriptionOverride?.trim() || undefined,
        },
        upload: fbDraft.upload,
      };
    }
    if (syndicationInstagramEnabled && instagramConnected && instagramAccountSelected && igDraft.enabled) {
      const mediaType: EditorInstagramMediaType =
        igDraft.options.mediaType === "feed" ? "feed" : "reels";
      next.instagram = {
        enabled: true,
        options: {
          captionOverride: igDraft.options.captionOverride?.trim() || undefined,
          mediaType,
        },
        upload: igDraft.upload,
      };
    }
    if (syndicationTiktokEnabled && tiktokConnected && ttDraft.enabled) {
      next.tiktok = {
        enabled: true,
        options: {
          captionOverride: ttDraft.options.captionOverride?.trim() || undefined,
          privacyLevel: ttDraft.options.privacyLevel?.trim() || undefined,
          disableDuet: ttDraft.options.disableDuet === true ? true : undefined,
          disableComment: ttDraft.options.disableComment === true ? true : undefined,
          disableStitch: ttDraft.options.disableStitch === true ? true : undefined,
          brandContentToggle: ttDraft.options.brandContentToggle === true ? true : undefined,
          brandOrganicToggle: ttDraft.options.brandOrganicToggle === true ? true : undefined,
        },
        upload: ttDraft.upload,
      };
    }
    if (!next.youtube && !next.twitter && !next.facebook && !next.instagram && !next.tiktok) {
      onSave(clip.id, undefined);
    } else {
      onSave(clip.id, next);
    }
    onOpenChange(false);
  }, [
    clip,
    readOnly,
    onSave,
    ytDraft,
    twDraft,
    fbDraft,
    igDraft,
    ttDraft,
    youtubeConnected,
    twitterConnected,
    facebookConnected,
    facebookPageSelected,
    instagramConnected,
    instagramAccountSelected,
    tiktokConnected,
    syndicationYoutubeEnabled,
    syndicationTwitterEnabled,
    syndicationFacebookEnabled,
    syndicationInstagramEnabled,
    syndicationTiktokEnabled,
    onOpenChange,
  ]);

  if (!clip) return null;

  const title = clip.title?.trim() || `Clip ${clip.order}`;
  const description = clip.description?.trim() || "";
  const tags = normalizeEditorClipTagsList(clip.tags ?? []);
  const posters = clip.posters ?? [];
  const enabledNetworks = {
    youtube: syndicationYoutubeEnabled,
    twitter: syndicationTwitterEnabled,
    facebook: syndicationFacebookEnabled,
    instagram: syndicationInstagramEnabled,
    tiktok: syndicationTiktokEnabled,
  };
  const hasYoutubeAccounts = youtubeAccounts.length > 0;
  const hasTwitterAccounts = twitterAccounts.length > 0;
  const hasFacebookAccounts = facebookAccounts.length > 0;
  const hasInstagramAccounts = instagramAccounts.length > 0;
  const hasTiktokAccounts = tiktokAccounts.length > 0;
  const tabItems = [
    enabledNetworks.youtube
      ? { id: "youtube", label: `YouTube${syndicationUploadTabSuffix(ytDraft, youtubeAccounts.length)}`, children: "YouTube" }
      : null,
    enabledNetworks.twitter
      ? { id: "twitter", label: `Twitter / X${syndicationUploadTabSuffix(twDraft, twitterAccounts.length)}`, children: "Twitter / X" }
      : null,
    enabledNetworks.facebook
      ? { id: "facebook", label: `Facebook${syndicationUploadTabSuffix(fbDraft, facebookAccounts.length)}`, children: "Facebook" }
      : null,
    enabledNetworks.instagram
      ? { id: "instagram", label: `Instagram${syndicationUploadTabSuffix(igDraft, instagramAccounts.length)}`, children: "Instagram" }
      : null,
    enabledNetworks.tiktok
      ? { id: "tiktok", label: `TikTok${syndicationUploadTabSuffix(ttDraft, tiktokAccounts.length)}`, children: "TikTok" }
      : null,
  ].filter(Boolean) as Array<{ id: string; label: string; children: string }>;
  const defaultTabId = tabItems[0]?.id || "youtube";

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      isKeyboardDismissDisabled={false}
    >
      <Modal>
        <Dialog
          aria-label="Syndication"
          className="mx-4 flex w-full max-w-xl justify-center outline-hidden sm:mx-auto"
        >
          <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
            <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
            <h2 className="pr-10 text-lg font-semibold text-primary">Syndication</h2>
            <p className="mt-1 text-xs text-tertiary">
              Configure YouTube, X, Facebook, Instagram, and TikTok publishing for this clip. Settings are stored on the
              clip and sent with the encode job.
            </p>
            <p className="mt-2 text-xs text-secondary">
              <span className="font-medium text-primary">{title}</span>
            </p>

            {readOnly ? (
              <p className="mt-3 rounded-lg border border-secondary bg-secondary px-3 py-2 text-xs text-secondary">
                This clip is encoding. Syndication controls are unavailable until the job finishes or is cancelled.
              </p>
            ) : null}

            {statusError ? <p className="mt-3 text-xs text-error-primary">{statusError}</p> : null}

            {tabItems.length === 0 ? (
              <p className="mt-4 rounded-lg border border-secondary bg-secondary/40 px-3 py-2 text-xs text-tertiary">
                Syndication is not enabled for this tenant. Enable at least one network in tenant settings.
              </p>
            ) : (
            <Tabs defaultSelectedKey={defaultTabId} className="mt-4 min-w-0 gap-3">
              <Tabs.List
                type="underline"
                orientation="horizontal"
                fullWidth
                items={tabItems}
              />
              {enabledNetworks.youtube ? (
              <Tabs.Panel id="youtube" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : !hasYoutubeAccounts ? (
                  <SyndicationOAuthBlock
                    description="Sign in with Google to allow Immergo to upload finished encodes to your YouTube channel."
                    authorizeLabel="Authorize with Google"
                    readOnly={readOnly}
                    authBusy={authBusy}
                    onAuthorize={() => void handleStartOAuth()}
                    mockAuthAvailable={youtubeMockAuthAvailable}
                    onMockAuthorize={() => void handleMockAuthorizeYoutube()}
                    mockLabel="Dev: mock connected (no Google)"
                  />
                ) : (
                  <div className="flex flex-col gap-4">
                    <Toggle
                      isSelected={ytDraft.enabled}
                      onChange={(v) => setYtDraft((d) => ({ ...d, enabled: v }))}
                      isDisabled={readOnly}
                      label="Syndicate this clip to YouTube after encode"
                      hint="When the VOD job completes, the backend uploads the MP4 using the options below."
                      size="sm"
                    />

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Privacy
                        <AppSelect
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.privacyStatus || "private"}
                          onChange={(value) =>
                            setOpt({ privacyStatus: value as EditorYoutubePrivacyStatus })
                          }
                          options={[
                            { value: "private", label: "Private" },
                            { value: "unlisted", label: "Unlisted" },
                            { value: "public", label: "Public" },
                          ]}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Category ID
                        <input
                          type="text"
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.categoryId || "22"}
                          onChange={(e) => setOpt({ categoryId: e.target.value })}
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                          placeholder="22"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        License
                        <AppSelect
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.license || "youtube"}
                          onChange={(value) =>
                            setOpt({ license: value as "youtube" | "creativeCommon" })
                          }
                          options={[
                            { value: "youtube", label: "Standard YouTube" },
                            { value: "creativeCommon", label: "Creative Commons" },
                          ]}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Default language (BCP-47, optional)
                        <input
                          type="text"
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.defaultLanguage || ""}
                          onChange={(e) => setOpt({ defaultLanguage: e.target.value })}
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                          placeholder="en"
                        />
                      </label>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Toggle
                        isSelected={ytDraft.options.embeddable !== false}
                        onChange={(v) => setOpt({ embeddable: v })}
                        isDisabled={readOnly || !ytDraft.enabled}
                        label="Allow embedding"
                        size="sm"
                      />
                      <Toggle
                        isSelected={ytDraft.options.publicStatsViewable !== false}
                        onChange={(v) => setOpt({ publicStatsViewable: v })}
                        isDisabled={readOnly || !ytDraft.enabled}
                        label="Public statistics viewable"
                        size="sm"
                      />
                      <Toggle
                        isSelected={!!ytDraft.options.selfDeclaredMadeForKids}
                        onChange={(v) => setOpt({ selfDeclaredMadeForKids: v })}
                        isDisabled={readOnly || !ytDraft.enabled}
                        label="Made for kids (self-declared)"
                        size="sm"
                      />
                      <Toggle
                        isSelected={!!ytDraft.options.notifySubscribers}
                        onChange={(v) => setOpt({ notifySubscribers: v })}
                        isDisabled={readOnly || !ytDraft.enabled}
                        label="Notify subscribers when published"
                        size="sm"
                      />
                    </div>

                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Title override (optional)
                      <input
                        type="text"
                        disabled={readOnly || !ytDraft.enabled}
                        value={ytDraft.options.titleOverride || ""}
                        onChange={(e) => setOpt({ titleOverride: e.target.value })}
                        placeholder={title}
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Description override (optional)
                      <textarea
                        disabled={readOnly || !ytDraft.enabled}
                        value={ytDraft.options.descriptionOverride || ""}
                        onChange={(e) => setOpt({ descriptionOverride: e.target.value })}
                        placeholder={description || "Uses clip description when empty"}
                        rows={3}
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Extra tags (comma-separated, optional)
                      <input
                        type="text"
                        disabled={readOnly || !ytDraft.enabled}
                        value={(ytDraft.options.tagsExtra || []).join(", ")}
                        onChange={(e) =>
                          setOpt({
                            tagsExtra: e.target.value
                              .split(/[,;]+/)
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>

                    <div className="rounded-lg border border-secondary bg-secondary/30 p-3">
                      <p className="text-xs font-medium text-secondary">Mapped clip metadata (defaults)</p>
                      <dl className="mt-2 space-y-2 text-sm">
                        <div>
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-tertiary">Title</dt>
                          <dd className="text-primary">{title}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-tertiary">Description</dt>
                          <dd className={description ? "text-primary" : "text-tertiary italic"}>
                            {description || "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-tertiary">Tags</dt>
                          <dd className="flex flex-wrap gap-1">
                            {tags.length === 0 ? (
                              <span className="text-tertiary italic">—</span>
                            ) : (
                              tags.map((t) => (
                                <span
                                  key={t}
                                  className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-secondary ring-1 ring-secondary ring-inset"
                                >
                                  {t}
                                </span>
                              ))
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-tertiary">Posters</dt>
                          <dd className="mt-1">
                            {posters.length === 0 ? (
                              <div className="flex items-center gap-2 text-tertiary">
                                <Image01 className="size-5 shrink-0 opacity-60" aria-hidden />
                                <span className="text-xs italic">No posters</span>
                              </div>
                            ) : (
                              <ul className="flex flex-wrap gap-2">
                                {posters.map((p) => (
                                  <li
                                    key={p.id}
                                    className="overflow-hidden rounded-md border border-secondary bg-primary"
                                  >
                                    {p.kind === "upload" ? (
                                      <img
                                        src={p.previewUrl}
                                        alt=""
                                        className="size-16 object-cover"
                                        loading="lazy"
                                      />
                                    ) : clipUrl.trim() && channelId.trim() ? (
                                      <img
                                        src={buildThumbnailUrl(clipUrl, p.timeSeconds, channelId)}
                                        alt=""
                                        className="size-16 object-cover"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="flex size-16 items-center justify-center text-[10px] text-tertiary">
                                        —
                                      </div>
                                    )}
                                    <div className="max-w-[4.5rem] truncate px-1 py-0.5 text-[9px] text-tertiary">
                                      {p.kind === "upload" ? p.originalName : formatTime(p.timeSeconds)}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <SyndicationUploadStatusBlock
                      branch={ytDraft}
                      accounts={youtubeAccounts}
                      linkLabel="Open video"
                      linkUrlKey="watchUrl"
                    />
                    <SyndicationAccountsPanel
                      accounts={youtubeAccounts}
                      readOnly={readOnly}
                      authBusy={authBusy}
                      onAddAccount={() => void handleStartOAuth()}
                      canAddAccount={platformLimits.youtube?.canAddAccount !== false}
                      maxAccounts={platformLimits.youtube?.maxAccounts ?? 5}
                      accountCount={platformLimits.youtube?.accountCount}
                    />
                  </div>
                )}
              </Tabs.Panel>
              ) : null}
              {enabledNetworks.twitter ? (
              <Tabs.Panel id="twitter" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : !hasTwitterAccounts ? (
                  <SyndicationOAuthBlock
                    description="Authorize Immergo with X to post the finished encode as a video tweet on your account."
                    authorizeLabel="Authorize with X"
                    readOnly={readOnly}
                    authBusy={authBusy}
                    onAuthorize={() => void handleStartTwitterOAuth()}
                    mockAuthAvailable={twitterMockAuthAvailable}
                    onMockAuthorize={() => void handleMockAuthorizeTwitter()}
                    mockLabel="Dev: mock connected (no X)"
                  />
                ) : (
                  <div className="flex flex-col gap-4">
                    <Toggle
                      isSelected={twDraft.enabled}
                      onChange={(v) => setTwDraft((d) => ({ ...d, enabled: v }))}
                      isDisabled={readOnly}
                      label="Syndicate this clip to X after encode"
                      hint="When the VOD job completes, the backend uploads the MP4 and publishes a video tweet."
                      size="sm"
                    />
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Tweet text override (optional)
                      <textarea
                        disabled={readOnly || !twDraft.enabled}
                        value={twDraft.options.textOverride || ""}
                        onChange={(e) =>
                          setTwDraft((d) => ({
                            ...d,
                            options: { ...d.options, textOverride: e.target.value },
                          }))
                        }
                        placeholder={title}
                        rows={3}
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>
                    <p className="text-xs text-tertiary">
                      Default tweet text is the clip title when override is empty. X may enforce length and media
                      limits per your developer plan.
                    </p>
                    <SyndicationUploadStatusBlock
                      branch={twDraft}
                      accounts={twitterAccounts}
                      linkLabel="Open post"
                      linkUrlKey="tweetUrl"
                    />
                    <SyndicationAccountsPanel
                      accounts={twitterAccounts}
                      readOnly={readOnly}
                      authBusy={authBusy}
                      onAddAccount={() => void handleStartTwitterOAuth()}
                      canAddAccount={platformLimits.twitter?.canAddAccount !== false}
                      maxAccounts={platformLimits.twitter?.maxAccounts ?? 5}
                      accountCount={platformLimits.twitter?.accountCount}
                    />
                  </div>
                )}
              </Tabs.Panel>
              ) : null}
              {enabledNetworks.facebook ? (
              <Tabs.Panel id="facebook" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : facebookPendingAccountId ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Choose which Facebook Page should receive syndicated videos for this authorization.
                    </p>
                    {pageBusy && facebookPages.length === 0 ? (
                      <p className="text-xs text-tertiary">Loading Pages…</p>
                    ) : facebookPages.length === 0 ? (
                      <p className="text-xs text-tertiary">
                        No Pages found, or all available Pages are already authorized.
                      </p>
                    ) : (
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Facebook Page
                        <AppSelect
                          disabled={readOnly || pageBusy}
                          value={selectedPageId || undefined}
                          onChange={(value) => setSelectedPageId(value ?? "")}
                          placeholder="Select a Page…"
                          allowClear
                          options={facebookPages.map((p) => ({ value: p.id, label: p.name }))}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={readOnly || pageBusy || !selectedPageId.trim()}
                      onClick={() => void handleSaveFacebookPage()}
                      className={cx(
                        "rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
                        (readOnly || pageBusy || !selectedPageId.trim()) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {pageBusy ? "Saving…" : "Save Page"}
                    </button>
                  </div>
                ) : !hasFacebookAccounts ? (
                  <SyndicationOAuthBlock
                    description="Sign in with Facebook to publish finished encodes to a Facebook Page you manage."
                    authorizeLabel="Authorize with Facebook"
                    readOnly={readOnly}
                    authBusy={authBusy}
                    onAuthorize={() => void handleStartFacebookOAuth()}
                    mockAuthAvailable={facebookMockAuthAvailable}
                    onMockAuthorize={() => void handleMockAuthorizeFacebook()}
                    mockLabel="Dev: mock connected (no Facebook)"
                  />
                ) : (
                  <div className="flex flex-col gap-4">
                    <Toggle
                      isSelected={fbDraft.enabled}
                      onChange={(v) => setFbDraft((d) => ({ ...d, enabled: v }))}
                      isDisabled={readOnly}
                      label="Syndicate this clip to Facebook after encode"
                      hint="When the VOD job completes, the backend publishes the MP4 to the selected Page."
                      size="sm"
                    />
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Title override (optional)
                      <input
                        type="text"
                        disabled={readOnly || !fbDraft.enabled}
                        value={fbDraft.options.titleOverride || ""}
                        onChange={(e) =>
                          setFbDraft((d) => ({
                            ...d,
                            options: { ...d.options, titleOverride: e.target.value },
                          }))
                        }
                        placeholder={title}
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Description override (optional)
                      <textarea
                        disabled={readOnly || !fbDraft.enabled}
                        value={fbDraft.options.descriptionOverride || ""}
                        onChange={(e) =>
                          setFbDraft((d) => ({
                            ...d,
                            options: { ...d.options, descriptionOverride: e.target.value },
                          }))
                        }
                        placeholder={description || "—"}
                        rows={3}
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>
                    <SyndicationUploadStatusBlock
                      branch={fbDraft}
                      accounts={facebookAccounts}
                      linkLabel="Open post"
                      linkUrlKey="permalinkUrl"
                    />
                    <SyndicationAccountsPanel
                      accounts={facebookAccounts}
                      readOnly={readOnly}
                      authBusy={authBusy}
                      onAddAccount={() => void handleStartFacebookOAuth()}
                      canAddAccount={platformLimits.facebook?.canAddAccount !== false}
                      maxAccounts={platformLimits.facebook?.maxAccounts ?? 5}
                      accountCount={platformLimits.facebook?.accountCount}
                    />
                  </div>
                )}
              </Tabs.Panel>
              ) : null}
              {enabledNetworks.instagram ? (
              <Tabs.Panel id="instagram" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : instagramPendingAccountId ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Choose which Instagram account should receive syndicated videos for this authorization.
                    </p>
                    {pageBusy && instagramPickerAccounts.length === 0 ? (
                      <p className="text-xs text-tertiary">Loading accounts…</p>
                    ) : instagramPickerAccounts.length === 0 ? (
                      <p className="text-xs text-tertiary">
                        No Instagram Business accounts found, or all available accounts are already authorized.
                      </p>
                    ) : (
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Instagram account
                        <AppSelect
                          disabled={readOnly || pageBusy}
                          value={selectedIgAccountId || undefined}
                          onChange={(value) => setSelectedIgAccountId(value ?? "")}
                          placeholder="Select an account…"
                          allowClear
                          options={instagramPickerAccounts.map((a) => ({
                            value: a.id,
                            label: `${a.username}${a.pageName ? ` (${a.pageName})` : ""}`,
                          }))}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={readOnly || pageBusy || !selectedIgAccountId.trim()}
                      onClick={() => void handleSaveInstagramAccount()}
                      className={cx(
                        "rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
                        (readOnly || pageBusy || !selectedIgAccountId.trim()) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {pageBusy ? "Saving…" : "Save account"}
                    </button>
                  </div>
                ) : !hasInstagramAccounts ? (
                  <SyndicationOAuthBlock
                    description="Sign in with Meta to publish finished encodes to an Instagram Business or Creator account linked to a Facebook Page."
                    authorizeLabel="Authorize with Instagram"
                    readOnly={readOnly}
                    authBusy={authBusy}
                    onAuthorize={() => void handleStartInstagramOAuth()}
                    mockAuthAvailable={instagramMockAuthAvailable}
                    onMockAuthorize={() => void handleMockAuthorizeInstagram()}
                    mockLabel="Dev: mock connected (no Instagram)"
                  />
                ) : (
                  <div className="flex flex-col gap-4">
                    <Toggle
                      isSelected={igDraft.enabled}
                      onChange={(v) => setIgDraft((d) => ({ ...d, enabled: v }))}
                      isDisabled={readOnly}
                      label="Syndicate this clip to Instagram after encode"
                      hint="When the VOD job completes, the backend publishes the MP4 to the selected account."
                      size="sm"
                    />
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Destination
                      <AppSelect
                        disabled={readOnly || !igDraft.enabled}
                        value={igDraft.options.mediaType === "feed" ? "feed" : "reels"}
                        onChange={(value) =>
                          setIgDraft((d) => ({
                            ...d,
                            options: {
                              ...d.options,
                              mediaType: value === "feed" ? "feed" : "reels",
                            },
                          }))
                        }
                        options={[
                          { value: "reels", label: "Reels" },
                          { value: "feed", label: "Feed (video post)" },
                        ]}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Caption override (optional)
                      <textarea
                        disabled={readOnly || !igDraft.enabled}
                        value={igDraft.options.captionOverride || ""}
                        onChange={(e) =>
                          setIgDraft((d) => ({
                            ...d,
                            options: { ...d.options, captionOverride: e.target.value },
                          }))
                        }
                        placeholder={[title, description].filter(Boolean).join("\n\n") || "—"}
                        rows={3}
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>
                    <SyndicationUploadStatusBlock
                      branch={igDraft}
                      accounts={instagramAccounts}
                      linkLabel="Open post"
                      linkUrlKey="permalinkUrl"
                    />
                    <SyndicationAccountsPanel
                      accounts={instagramAccounts}
                      readOnly={readOnly}
                      authBusy={authBusy}
                      onAddAccount={() => void handleStartInstagramOAuth()}
                      canAddAccount={platformLimits.instagram?.canAddAccount !== false}
                      maxAccounts={platformLimits.instagram?.maxAccounts ?? 5}
                      accountCount={platformLimits.instagram?.accountCount}
                    />
                  </div>
                )}
              </Tabs.Panel>
              ) : null}
              {enabledNetworks.tiktok ? (
              <Tabs.Panel id="tiktok" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : !hasTiktokAccounts ? (
                  <div className="flex flex-col gap-3">
                    <SyndicationOAuthBlock
                      description="Sign in with TikTok to publish finished encodes to your TikTok account (Direct Post API)."
                      authorizeLabel="Authorize with TikTok"
                      readOnly={readOnly}
                      authBusy={authBusy}
                      onAuthorize={() => void handleStartTiktokOAuth()}
                      mockAuthAvailable={tiktokMockAuthAvailable}
                      onMockAuthorize={() => void handleMockAuthorizeTiktok()}
                      mockLabel="Dev: mock connected (no TikTok)"
                    />
                    <p className="text-xs text-tertiary">
                      Unaudited apps may only publish as private until TikTok approves your Content Posting API
                      integration. Verify your MP4 output URL domain in the TikTok developer portal for pull-from-URL
                      uploads.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {creatorInfoBusy && !tiktokCreatorInfo ? (
                      <p className="text-xs text-tertiary">Loading creator settings…</p>
                    ) : null}
                    <Toggle
                      isSelected={ttDraft.enabled}
                      onChange={(v) => setTtDraft((d) => ({ ...d, enabled: v }))}
                      isDisabled={readOnly}
                      label="Syndicate this clip to TikTok after encode"
                      hint="When the VOD job completes, the backend publishes the MP4 via TikTok Direct Post."
                      size="sm"
                    />
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Privacy
                      <AppSelect
                        disabled={readOnly || !ttDraft.enabled || creatorInfoBusy}
                        value={ttDraft.options.privacyLevel || undefined}
                        onChange={(value) =>
                          setTtDraft((d) => ({
                            ...d,
                            options: { ...d.options, privacyLevel: value ?? "" },
                          }))
                        }
                        options={(tiktokCreatorInfo?.privacy_level_options?.length
                          ? tiktokCreatorInfo.privacy_level_options
                          : ["SELF_ONLY"]
                        ).map((p) => ({
                          value: p,
                          label: p.replace(/_/g, " ").toLowerCase(),
                        }))}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                      Caption override (optional)
                      <textarea
                        disabled={readOnly || !ttDraft.enabled}
                        value={ttDraft.options.captionOverride || ""}
                        onChange={(e) =>
                          setTtDraft((d) => ({
                            ...d,
                            options: { ...d.options, captionOverride: e.target.value },
                          }))
                        }
                        placeholder={[title, description].filter(Boolean).join("\n\n") || "—"}
                        rows={3}
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      />
                    </label>
                    <div className="flex flex-col gap-2">
                      <Toggle
                        isSelected={ttDraft.options.disableDuet === true}
                        onChange={(v) => setTtDraft((d) => ({ ...d, options: { ...d.options, disableDuet: v } }))}
                        isDisabled={readOnly || !ttDraft.enabled || tiktokCreatorInfo?.duet_disabled === true}
                        label="Disable duet"
                        size="sm"
                      />
                      <Toggle
                        isSelected={ttDraft.options.disableComment === true}
                        onChange={(v) => setTtDraft((d) => ({ ...d, options: { ...d.options, disableComment: v } }))}
                        isDisabled={readOnly || !ttDraft.enabled || tiktokCreatorInfo?.comment_disabled === true}
                        label="Disable comments"
                        size="sm"
                      />
                      <Toggle
                        isSelected={ttDraft.options.disableStitch === true}
                        onChange={(v) => setTtDraft((d) => ({ ...d, options: { ...d.options, disableStitch: v } }))}
                        isDisabled={readOnly || !ttDraft.enabled || tiktokCreatorInfo?.stitch_disabled === true}
                        label="Disable stitch"
                        size="sm"
                      />
                      <Toggle
                        isSelected={ttDraft.options.brandContentToggle === true}
                        onChange={(v) =>
                          setTtDraft((d) => ({ ...d, options: { ...d.options, brandContentToggle: v } }))
                        }
                        isDisabled={readOnly || !ttDraft.enabled}
                        label="Paid partnership (brand content)"
                        size="sm"
                      />
                      <Toggle
                        isSelected={ttDraft.options.brandOrganicToggle === true}
                        onChange={(v) =>
                          setTtDraft((d) => ({ ...d, options: { ...d.options, brandOrganicToggle: v } }))
                        }
                        isDisabled={readOnly || !ttDraft.enabled}
                        label="Promoting my own business (brand organic)"
                        size="sm"
                      />
                    </div>
                    <SyndicationUploadStatusBlock
                      branch={ttDraft}
                      accounts={tiktokAccounts}
                      linkLabel="Open post"
                      linkUrlKey="shareUrl"
                    />
                    <SyndicationAccountsPanel
                      accounts={tiktokAccounts}
                      readOnly={readOnly}
                      authBusy={authBusy}
                      onAddAccount={() => void handleStartTiktokOAuth()}
                      canAddAccount={platformLimits.tiktok?.canAddAccount !== false}
                      maxAccounts={platformLimits.tiktok?.maxAccounts ?? 5}
                      accountCount={platformLimits.tiktok?.accountCount}
                    />
                  </div>
                )}
              </Tabs.Panel>
              ) : null}
            </Tabs>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              {readOnly ||
              !(
                (syndicationYoutubeEnabled && youtubeConnected) ||
                (syndicationTwitterEnabled && twitterConnected) ||
                (syndicationFacebookEnabled && facebookConnected && facebookPageSelected) ||
                (syndicationInstagramEnabled && instagramConnected && instagramAccountSelected) ||
                (syndicationTiktokEnabled && tiktokConnected)
              ) ||
              !onSave ? null : (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover"
                >
                  Save
                </button>
              )}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
