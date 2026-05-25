import { useCallback, useEffect, useState } from "react";
import { Image01 } from "@untitledui/icons";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { Tabs } from "@/components/application/tabs/tabs";
import { CloseButton } from "@/components/base/buttons/close-button";
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
} from "@/services/tenant-syndication.service";
import type {
  FacebookPageOption,
  InstagramAccountOption,
  TiktokCreatorInfo,
} from "@/services/tenant-syndication.service";
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
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [twitterConnected, setTwitterConnected] = useState(false);
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [facebookPageSelected, setFacebookPageSelected] = useState(false);
  const [facebookPageName, setFacebookPageName] = useState<string | null>(null);
  const [youtubeMockAuthAvailable, setYoutubeMockAuthAvailable] = useState(false);
  const [twitterMockAuthAvailable, setTwitterMockAuthAvailable] = useState(false);
  const [facebookMockAuthAvailable, setFacebookMockAuthAvailable] = useState(false);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [instagramAccountSelected, setInstagramAccountSelected] = useState(false);
  const [instagramUsername, setInstagramUsername] = useState<string | null>(null);
  const [instagramMockAuthAvailable, setInstagramMockAuthAvailable] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [facebookPages, setFacebookPages] = useState<FacebookPageOption[]>([]);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccountOption[]>([]);
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
  const [tiktokUsername, setTiktokUsername] = useState<string | null>(null);
  const [tiktokMockAuthAvailable, setTiktokMockAuthAvailable] = useState(false);
  const [tiktokCreatorInfo, setTiktokCreatorInfo] = useState<TiktokCreatorInfo | null>(null);
  const [creatorInfoBusy, setCreatorInfoBusy] = useState(false);
  const [ttDraft, setTtDraft] = useState<EditorClipTiktokSyndication>(() =>
    clip ? defaultTiktokBranch(clip, syndicationTiktokDefaultEnabled) : { enabled: false, options: {} },
  );

  const loadStatus = useCallback(async () => {
    const id = tenantId.trim();
    if (!id) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await fetchTenantSyndicationStatus(id);
      setYoutubeConnected(s.youtube.connected);
      setTwitterConnected(s.twitter.connected);
      setFacebookConnected(s.facebook.connected);
      setFacebookPageSelected(s.facebook.pageSelected);
      setFacebookPageName(s.facebook.pageName);
      setYoutubeMockAuthAvailable(!!s.youtube.mockAuthAvailable);
      setTwitterMockAuthAvailable(!!s.twitter.mockAuthAvailable);
      setFacebookMockAuthAvailable(!!s.facebook.mockAuthAvailable);
      setInstagramConnected(s.instagram.connected);
      setInstagramAccountSelected(s.instagram.accountSelected);
      setInstagramUsername(s.instagram.username);
      setInstagramMockAuthAvailable(!!s.instagram.mockAuthAvailable);
      setTiktokConnected(s.tiktok.connected);
      setTiktokUsername(s.tiktok.username);
      setTiktokMockAuthAvailable(!!s.tiktok.mockAuthAvailable);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to load syndication status");
      setYoutubeConnected(false);
      setTwitterConnected(false);
      setFacebookConnected(false);
      setFacebookPageSelected(false);
      setFacebookPageName(null);
      setInstagramConnected(false);
      setInstagramAccountSelected(false);
      setInstagramUsername(null);
      setYoutubeMockAuthAvailable(false);
      setTwitterMockAuthAvailable(false);
      setFacebookMockAuthAvailable(false);
      setInstagramMockAuthAvailable(false);
      setTiktokConnected(false);
      setTiktokUsername(null);
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
    if (!id || !tiktokConnected) return;
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
  }, [tenantId, tiktokConnected, ttDraft.options.privacyLevel]);

  useEffect(() => {
    if (!isOpen || !tiktokConnected) return;
    void loadTiktokCreatorInfo();
  }, [isOpen, tiktokConnected, loadTiktokCreatorInfo]);

  const loadFacebookPages = useCallback(async () => {
    const id = tenantId.trim();
    if (!id || !facebookConnected) return;
    setPageBusy(true);
    setStatusError(null);
    try {
      const pages = await fetchTenantSyndicationFacebookPages(id);
      setFacebookPages(pages);
      if (pages.length === 1) setSelectedPageId(pages[0].id);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to load Facebook Pages");
      setFacebookPages([]);
    } finally {
      setPageBusy(false);
    }
  }, [tenantId, facebookConnected]);

  useEffect(() => {
    if (!isOpen || !facebookConnected || facebookPageSelected) return;
    void loadFacebookPages();
  }, [isOpen, facebookConnected, facebookPageSelected, loadFacebookPages]);

  const loadInstagramAccounts = useCallback(async () => {
    const id = tenantId.trim();
    if (!id || !instagramConnected) return;
    setPageBusy(true);
    setStatusError(null);
    try {
      const accounts = await fetchTenantSyndicationInstagramAccounts(id);
      setInstagramAccounts(accounts);
      if (accounts.length === 1) setSelectedIgAccountId(accounts[0].id);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to load Instagram accounts");
      setInstagramAccounts([]);
    } finally {
      setPageBusy(false);
    }
  }, [tenantId, instagramConnected]);

  useEffect(() => {
    if (!isOpen || !instagramConnected || instagramAccountSelected) return;
    void loadInstagramAccounts();
  }, [isOpen, instagramConnected, instagramAccountSelected, loadInstagramAccounts]);

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
      const s = await postTenantSyndicationFacebookSelectPage(tenantId.trim(), selectedPageId.trim());
      setFacebookPageSelected(s.facebook.pageSelected);
      setFacebookPageName(s.facebook.pageName);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to save Facebook Page");
    } finally {
      setPageBusy(false);
    }
  }, [tenantId, readOnly, selectedPageId]);

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
      const s = await postTenantSyndicationInstagramSelectAccount(tenantId.trim(), selectedIgAccountId.trim());
      setInstagramAccountSelected(s.instagram.accountSelected);
      setInstagramUsername(s.instagram.username);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Failed to save Instagram account");
    } finally {
      setPageBusy(false);
    }
  }, [tenantId, readOnly, selectedIgAccountId]);

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
  const tabItems = [
    enabledNetworks.youtube ? { id: "youtube", label: "YouTube", children: "YouTube" } : null,
    enabledNetworks.twitter ? { id: "twitter", label: "Twitter / X", children: "Twitter / X" } : null,
    enabledNetworks.facebook ? { id: "facebook", label: "Facebook", children: "Facebook" } : null,
    enabledNetworks.instagram ? { id: "instagram", label: "Instagram", children: "Instagram" } : null,
    enabledNetworks.tiktok ? { id: "tiktok", label: "TikTok", children: "TikTok" } : null,
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
                ) : !youtubeConnected ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Sign in with Google to allow Immergo to upload finished encodes to your YouTube channel.
                    </p>
                    <button
                      type="button"
                      disabled={readOnly || authBusy}
                      onClick={() => void handleStartOAuth()}
                      className={cx(
                        "rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
                        (readOnly || authBusy) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {authBusy ? "Redirecting…" : "Authorize with Google"}
                    </button>
                    {youtubeMockAuthAvailable ? (
                      <button
                        type="button"
                        disabled={readOnly || authBusy}
                        onClick={() => void handleMockAuthorizeYoutube()}
                        className="rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-medium text-secondary hover:bg-tertiary/40"
                      >
                        Dev: mock connected (no Google)
                      </button>
                    ) : null}
                  </div>
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
                        <select
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.privacyStatus || "private"}
                          onChange={(e) =>
                            setOpt({ privacyStatus: e.target.value as EditorYoutubePrivacyStatus })
                          }
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                        >
                          <option value="private">Private</option>
                          <option value="unlisted">Unlisted</option>
                          <option value="public">Public</option>
                        </select>
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
                        <select
                          disabled={readOnly || !ytDraft.enabled}
                          value={ytDraft.options.license || "youtube"}
                          onChange={(e) => setOpt({ license: e.target.value as "youtube" | "creativeCommon" })}
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                        >
                          <option value="youtube">Standard YouTube</option>
                          <option value="creativeCommon">Creative Commons</option>
                        </select>
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

                    {ytDraft.upload?.state ? (
                      <p className="rounded-md border border-secondary bg-secondary px-2 py-2 text-xs text-secondary">
                        Upload status: <strong className="text-primary">{ytDraft.upload.state}</strong>
                        {ytDraft.upload.message ? ` — ${ytDraft.upload.message}` : ""}
                        {ytDraft.upload.watchUrl ? (
                          <>
                            {" "}
                            <a
                              href={ytDraft.upload.watchUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand-secondary underline"
                            >
                              Open video
                            </a>
                          </>
                        ) : null}
                        {ytDraft.upload.error ? (
                          <span className="mt-1 block text-error-primary">{ytDraft.upload.error}</span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                )}
              </Tabs.Panel>
              ) : null}
              {enabledNetworks.twitter ? (
              <Tabs.Panel id="twitter" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : !twitterConnected ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Authorize Immergo with X to post the finished encode as a video tweet on your account.
                    </p>
                    <button
                      type="button"
                      disabled={readOnly || authBusy}
                      onClick={() => void handleStartTwitterOAuth()}
                      className={cx(
                        "rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
                        (readOnly || authBusy) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {authBusy ? "Redirecting…" : "Authorize with X"}
                    </button>
                    {twitterMockAuthAvailable ? (
                      <button
                        type="button"
                        disabled={readOnly || authBusy}
                        onClick={() => void handleMockAuthorizeTwitter()}
                        className="rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-medium text-secondary hover:bg-tertiary/40"
                      >
                        Dev: mock connected (no X)
                      </button>
                    ) : null}
                  </div>
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
                    {twDraft.upload?.state ? (
                      <p className="rounded-md border border-secondary bg-secondary px-2 py-2 text-xs text-secondary">
                        Upload status: <strong className="text-primary">{twDraft.upload.state}</strong>
                        {twDraft.upload.message ? ` — ${twDraft.upload.message}` : ""}
                        {twDraft.upload.tweetUrl ? (
                          <>
                            {" "}
                            <a
                              href={twDraft.upload.tweetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand-secondary underline"
                            >
                              Open post
                            </a>
                          </>
                        ) : null}
                        {twDraft.upload.error ? (
                          <span className="mt-1 block text-error-primary">{twDraft.upload.error}</span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                )}
              </Tabs.Panel>
              ) : null}
              {enabledNetworks.facebook ? (
              <Tabs.Panel id="facebook" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : !facebookConnected ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Sign in with Facebook to publish finished encodes to a Facebook Page you manage.
                    </p>
                    <button
                      type="button"
                      disabled={readOnly || authBusy}
                      onClick={() => void handleStartFacebookOAuth()}
                      className={cx(
                        "rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
                        (readOnly || authBusy) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {authBusy ? "Redirecting…" : "Authorize with Facebook"}
                    </button>
                    {facebookMockAuthAvailable ? (
                      <button
                        type="button"
                        disabled={readOnly || authBusy}
                        onClick={() => void handleMockAuthorizeFacebook()}
                        className="rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-medium text-secondary hover:bg-tertiary/40"
                      >
                        Dev: mock connected (no Facebook)
                      </button>
                    ) : null}
                  </div>
                ) : !facebookPageSelected ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Choose which Facebook Page should receive syndicated videos for this tenant.
                    </p>
                    {pageBusy && facebookPages.length === 0 ? (
                      <p className="text-xs text-tertiary">Loading Pages…</p>
                    ) : facebookPages.length === 0 ? (
                      <p className="text-xs text-tertiary">
                        No Pages found. Ensure your Facebook account manages at least one Page.
                      </p>
                    ) : (
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Facebook Page
                        <select
                          disabled={readOnly || pageBusy}
                          value={selectedPageId}
                          onChange={(e) => setSelectedPageId(e.target.value)}
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                        >
                          <option value="">Select a Page…</option>
                          {facebookPages.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
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
                ) : (
                  <div className="flex flex-col gap-4">
                    <p className="text-xs text-secondary">
                      Connected Page: <strong className="text-primary">{facebookPageName || "—"}</strong>
                    </p>
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
                    {fbDraft.upload?.state ? (
                      <p className="rounded-md border border-secondary bg-secondary px-2 py-2 text-xs text-secondary">
                        Upload status: <strong className="text-primary">{fbDraft.upload.state}</strong>
                        {fbDraft.upload.message ? ` — ${fbDraft.upload.message}` : ""}
                        {fbDraft.upload.permalinkUrl ? (
                          <>
                            {" "}
                            <a
                              href={fbDraft.upload.permalinkUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand-secondary underline"
                            >
                              Open post
                            </a>
                          </>
                        ) : null}
                        {fbDraft.upload.error ? (
                          <span className="mt-1 block text-error-primary">{fbDraft.upload.error}</span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                )}
              </Tabs.Panel>
              ) : null}
              {enabledNetworks.instagram ? (
              <Tabs.Panel id="instagram" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : !instagramConnected ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Sign in with Meta to publish finished encodes to an Instagram Business or Creator account linked
                      to a Facebook Page.
                    </p>
                    <button
                      type="button"
                      disabled={readOnly || authBusy}
                      onClick={() => void handleStartInstagramOAuth()}
                      className={cx(
                        "rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
                        (readOnly || authBusy) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {authBusy ? "Redirecting…" : "Authorize with Instagram"}
                    </button>
                    {instagramMockAuthAvailable ? (
                      <button
                        type="button"
                        disabled={readOnly || authBusy}
                        onClick={() => void handleMockAuthorizeInstagram()}
                        className="rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-medium text-secondary hover:bg-tertiary/40"
                      >
                        Dev: mock connected (no Instagram)
                      </button>
                    ) : null}
                  </div>
                ) : !instagramAccountSelected ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Choose which Instagram account should receive syndicated videos for this tenant.
                    </p>
                    {pageBusy && instagramAccounts.length === 0 ? (
                      <p className="text-xs text-tertiary">Loading accounts…</p>
                    ) : instagramAccounts.length === 0 ? (
                      <p className="text-xs text-tertiary">
                        No Instagram Business accounts found. Link an Instagram account to a Facebook Page you manage.
                      </p>
                    ) : (
                      <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
                        Instagram account
                        <select
                          disabled={readOnly || pageBusy}
                          value={selectedIgAccountId}
                          onChange={(e) => setSelectedIgAccountId(e.target.value)}
                          className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                        >
                          <option value="">Select an account…</option>
                          {instagramAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              @{a.username}
                              {a.pageName ? ` (${a.pageName})` : ""}
                            </option>
                          ))}
                        </select>
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
                ) : (
                  <div className="flex flex-col gap-4">
                    <p className="text-xs text-secondary">
                      Connected account:{" "}
                      <strong className="text-primary">
                        {instagramUsername ? `@${instagramUsername}` : "—"}
                      </strong>
                    </p>
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
                      <select
                        disabled={readOnly || !igDraft.enabled}
                        value={igDraft.options.mediaType === "feed" ? "feed" : "reels"}
                        onChange={(e) =>
                          setIgDraft((d) => ({
                            ...d,
                            options: {
                              ...d.options,
                              mediaType: e.target.value === "feed" ? "feed" : "reels",
                            },
                          }))
                        }
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      >
                        <option value="reels">Reels</option>
                        <option value="feed">Feed (video post)</option>
                      </select>
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
                    {igDraft.upload?.state ? (
                      <p className="rounded-md border border-secondary bg-secondary px-2 py-2 text-xs text-secondary">
                        Upload status: <strong className="text-primary">{igDraft.upload.state}</strong>
                        {igDraft.upload.message ? ` — ${igDraft.upload.message}` : ""}
                        {igDraft.upload.permalinkUrl ? (
                          <>
                            {" "}
                            <a
                              href={igDraft.upload.permalinkUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand-secondary underline"
                            >
                              Open post
                            </a>
                          </>
                        ) : null}
                        {igDraft.upload.error ? (
                          <span className="mt-1 block text-error-primary">{igDraft.upload.error}</span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                )}
              </Tabs.Panel>
              ) : null}
              {enabledNetworks.tiktok ? (
              <Tabs.Panel id="tiktok" className="pt-2">
                {statusLoading ? (
                  <p className="text-sm text-tertiary">Loading connection status…</p>
                ) : !tiktokConnected ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary/40 p-4">
                    <p className="text-sm text-primary">
                      Sign in with TikTok to publish finished encodes to your TikTok account (Direct Post API).
                    </p>
                    <p className="text-xs text-tertiary">
                      Unaudited apps may only publish as private until TikTok approves your Content Posting API
                      integration. Verify your MP4 output URL domain in the TikTok developer portal for pull-from-URL
                      uploads.
                    </p>
                    <button
                      type="button"
                      disabled={readOnly || authBusy}
                      onClick={() => void handleStartTiktokOAuth()}
                      className={cx(
                        "rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover",
                        (readOnly || authBusy) && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {authBusy ? "Redirecting…" : "Authorize with TikTok"}
                    </button>
                    {tiktokMockAuthAvailable ? (
                      <button
                        type="button"
                        disabled={readOnly || authBusy}
                        onClick={() => void handleMockAuthorizeTiktok()}
                        className="rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-medium text-secondary hover:bg-tertiary/40"
                      >
                        Dev: mock connected (no TikTok)
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <p className="text-xs text-secondary">
                      Connected account:{" "}
                      <strong className="text-primary">
                        {tiktokUsername
                          ? `@${tiktokUsername}`
                          : tiktokCreatorInfo?.creator_username
                            ? `@${tiktokCreatorInfo.creator_username}`
                            : "—"}
                      </strong>
                    </p>
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
                      <select
                        disabled={readOnly || !ttDraft.enabled || creatorInfoBusy}
                        value={ttDraft.options.privacyLevel || ""}
                        onChange={(e) =>
                          setTtDraft((d) => ({
                            ...d,
                            options: { ...d.options, privacyLevel: e.target.value },
                          }))
                        }
                        className="rounded-lg border border-secondary bg-primary px-2 py-2 text-sm text-primary"
                      >
                        {(tiktokCreatorInfo?.privacy_level_options?.length
                          ? tiktokCreatorInfo.privacy_level_options
                          : ["SELF_ONLY"]
                        ).map((p) => (
                          <option key={p} value={p}>
                            {p.replace(/_/g, " ").toLowerCase()}
                          </option>
                        ))}
                      </select>
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
                    {ttDraft.upload?.state ? (
                      <p className="rounded-md border border-secondary bg-secondary px-2 py-2 text-xs text-secondary">
                        Upload status: <strong className="text-primary">{ttDraft.upload.state}</strong>
                        {ttDraft.upload.message ? ` — ${ttDraft.upload.message}` : ""}
                        {ttDraft.upload.shareUrl ? (
                          <>
                            {" "}
                            <a
                              href={ttDraft.upload.shareUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand-secondary underline"
                            >
                              Open post
                            </a>
                          </>
                        ) : null}
                        {ttDraft.upload.error ? (
                          <span className="mt-1 block text-error-primary">{ttDraft.upload.error}</span>
                        ) : null}
                      </p>
                    ) : null}
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
