import { useEffect, useMemo, useState } from "react";
import { Plus } from "@untitledui/icons";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import type {
  EditorAdMarker,
  EditorClipSyndication,
  EditorCropWindow,
  EditorSelectionMode,
  EditorSubClip,
  EditorVerticalCropBreakpoint,
  EditorVerticalCropPanSettings,
} from "@/types/editor";
import type { VodJobRecord } from "@/types/vod-job";
import { cx } from "@/utils/cx";
import { EditorAdsList } from "./editor-ads-list";
import { EditorClipMetadataModal } from "./editor-clip-metadata-modal";
import { EditorClipsList } from "./editor-clips-list";
import { EditorSyndicationModal } from "./editor-syndication-modal";
import { EditorVerticalCropBreakpointsModal } from "./editor-vertical-crop-breakpoints-modal";

interface EditorRightPanelProps {
  selectionMode: EditorSelectionMode;
  clips: EditorSubClip[];
  clipUrl: string;
  channelId: string;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  playingClipId: string | null;
  isPlaying: boolean;
  onPlaySubclip: (clip: EditorSubClip) => void;
  onPause: () => void;
  onRemoveClip: (id: string) => void;
  onUpdateClipMetadata: (
    clipId: string,
    patch: Pick<EditorSubClip, "title" | "description" | "posters" | "tags">,
  ) => void;
  onUpdateClipSyndication?: (clipId: string, syndication: EditorClipSyndication | undefined) => void;
  onSeek: (timeSeconds: number) => void;
  thumbnailsEnabled: boolean;
  clipsEmptyHint: string;
  /** Max seconds in the parent window (for clamping clip in/out in the list). */
  parentWindowDurationSec: number;
  onClipTimesCommit: (
    clipId: string,
    startTime: number,
    endTime: number,
  ) => { startTime: number; endTime: number } | null;
  onAdTimesCommit?: (
    adId: string,
    startTime: number,
    endTime: number,
  ) => { startTime: number; endTime: number } | null;
  onAddVerticalClip: () => void;
  onAddHorizontalClip: () => void;
  onAddAdSlot?: () => void;
  addAdSlotDisabled?: boolean;
  vodJobs: VodJobRecord[];
  clipVodEncodeErrors: Record<string, string>;
  onClipStartVodEncode: (clipId: string, includeAds: boolean) => void | Promise<void>;
  onClipCancelVodEncode: (clipId: string) => void | Promise<void>;
  /** VOD timeline ad markers (EPG / time picker only). */
  ads?: EditorAdMarker[];
  selectedAdId?: string | null;
  onSelectAd?: (id: string | null) => void;
  onRemoveAd?: (id: string) => void;
  onAdOrderChange?: (id: string, newIndex: number) => void;
  onSaveVerticalCropFromModal?: (
    clipId: string,
    patch: {
      verticalCropMode: boolean;
      cropWindow: EditorCropWindow | null;
      verticalCropBreakpoints: EditorVerticalCropBreakpoint[] | undefined;
      verticalCropPanSettings?: EditorVerticalCropPanSettings | undefined;
    },
  ) => void;
  onToggleClipSubtitle?: (clipId: string) => void;
  /** Tenant slug from URL; required for syndication API. */
  syndicationTenantId?: string;
  /** When true with tenant id, show per-clip syndication for YouTube. */
  syndicationYoutubeEnabled?: boolean;
  /** When true with tenant id, show per-clip syndication for X / Twitter. */
  syndicationTwitterEnabled?: boolean;
  /** When true with tenant id, show per-clip syndication for Facebook. */
  syndicationFacebookEnabled?: boolean;
  /** When true with tenant id, show per-clip syndication for Instagram. */
  syndicationInstagramEnabled?: boolean;
  /** When true with tenant id, show per-clip syndication for TikTok. */
  syndicationTiktokEnabled?: boolean;
  /** Append a frame bookmark at the current playhead for this sub-clip. */
  onCaptureClipPoster?: (clipId: string) => void;
  onAddTextWidget?: (clipId: string) => void;
  onAddImageWidgetFromFile?: (clipId: string, file: File) => Promise<void>;
  /** Realtime mode: show per-clip transcript action + modal. */
  realtimeTranscriptUi?: boolean;
  /** Refetch VOD jobs after transcript speaker PATCH (realtime modal). */
  onVodJobsRefresh?: () => Promise<void>;
}

/**
 * Right sidebar: sub-clips list, per-clip metadata, ads, create actions.
 */
export function EditorRightPanel({
  selectionMode,
  clips,
  clipUrl,
  channelId,
  selectedClipId,
  onSelectClip,
  playingClipId,
  isPlaying,
  onPlaySubclip,
  onPause,
  onRemoveClip,
  onUpdateClipMetadata,
  onUpdateClipSyndication,
  onSeek,
  thumbnailsEnabled,
  clipsEmptyHint,
  parentWindowDurationSec,
  onClipTimesCommit,
  onAdTimesCommit,
  onAddVerticalClip,
  onAddHorizontalClip,
  onAddAdSlot,
  addAdSlotDisabled = false,
  vodJobs,
  clipVodEncodeErrors,
  onClipStartVodEncode,
  onClipCancelVodEncode,
  ads = [],
  selectedAdId = null,
  onSelectAd,
  onRemoveAd,
  onAdOrderChange,
  onSaveVerticalCropFromModal,
  onToggleClipSubtitle,
  syndicationTenantId = "",
  syndicationYoutubeEnabled = false,
  syndicationTwitterEnabled = false,
  syndicationFacebookEnabled = false,
  syndicationInstagramEnabled = false,
  syndicationTiktokEnabled = false,
  onCaptureClipPoster,
  onAddTextWidget,
  onAddImageWidgetFromFile,
  realtimeTranscriptUi = false,
  onVodJobsRefresh,
}: EditorRightPanelProps) {
  const [clipMetadataId, setClipMetadataId] = useState<string | null>(null);
  const [syndicationClipId, setSyndicationClipId] = useState<string | null>(null);
  const [verticalCropModalClipId, setVerticalCropModalClipId] = useState<string | null>(null);

  const clipForMetadata = useMemo(
    () => (clipMetadataId ? clips.find((c) => c.id === clipMetadataId) ?? null : null),
    [clips, clipMetadataId],
  );

  const clipForSyndication = useMemo(
    () => (syndicationClipId ? clips.find((c) => c.id === syndicationClipId) ?? null : null),
    [clips, syndicationClipId],
  );

  const clipForVerticalCropModal = useMemo(
    () =>
      verticalCropModalClipId ? clips.find((c) => c.id === verticalCropModalClipId) ?? null : null,
    [clips, verticalCropModalClipId],
  );

  const clipMetadataReadOnly = useMemo(() => {
    if (!clipMetadataId) return false;
    let best: VodJobRecord | undefined;
    for (const j of vodJobs) {
      if (j.editorClipId !== clipMetadataId) continue;
      if (j.jobKind === "realtime_transcribe") continue;
      if (!best || j.createdAt > best.createdAt) best = j;
    }
    if (!best) return false;
    return (
      best.status === "queued" ||
      best.status === "processing" ||
      best.status === "uploading" ||
      best.status === "cancelling"
    );
  }, [clipMetadataId, vodJobs]);

  const syndicationReadOnly = useMemo(() => {
    if (!syndicationClipId) return false;
    let best: VodJobRecord | undefined;
    for (const j of vodJobs) {
      if (j.editorClipId !== syndicationClipId) continue;
      if (j.jobKind === "realtime_transcribe") continue;
      if (!best || j.createdAt > best.createdAt) best = j;
    }
    if (!best) return false;
    return (
      best.status === "queued" ||
      best.status === "processing" ||
      best.status === "uploading" ||
      best.status === "cancelling"
    );
  }, [syndicationClipId, vodJobs]);

  useEffect(() => {
    if (clipMetadataId && !clips.some((c) => c.id === clipMetadataId)) {
      setClipMetadataId(null);
    }
  }, [clips, clipMetadataId]);

  useEffect(() => {
    if (syndicationClipId && !clips.some((c) => c.id === syndicationClipId)) {
      setSyndicationClipId(null);
    }
  }, [clips, syndicationClipId]);

  useEffect(() => {
    if (verticalCropModalClipId && !clips.some((c) => c.id === verticalCropModalClipId)) {
      setVerticalCropModalClipId(null);
    }
  }, [clips, verticalCropModalClipId]);

  const verticalCropModalReadOnly = useMemo(() => {
    if (!verticalCropModalClipId) return false;
    let best: VodJobRecord | undefined;
    for (const j of vodJobs) {
      if (j.editorClipId !== verticalCropModalClipId) continue;
      if (j.jobKind === "realtime_transcribe") continue;
      if (!best || j.createdAt > best.createdAt) best = j;
    }
    if (!best) return false;
    return (
      best.status === "queued" ||
      best.status === "processing" ||
      best.status === "uploading" ||
      best.status === "cancelling"
    );
  }, [verticalCropModalClipId, vodJobs]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 bg-primary">
      <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex flex-col gap-4">
            <EditorClipsList
              clips={clips}
              clipUrl={clipUrl}
              channelId={channelId}
              selectedClipId={selectedClipId}
              onSelectClip={onSelectClip}
              playingClipId={playingClipId}
              isPlaying={isPlaying}
              onPlaySubclip={onPlaySubclip}
              onPause={onPause}
              onRemove={onRemoveClip}
              onEditMetadata={(c) => setClipMetadataId(c.id)}
              onSeek={onSeek}
              thumbnailsEnabled={thumbnailsEnabled}
              emptyHint={clipsEmptyHint}
              parentWindowDurationSec={parentWindowDurationSec}
              onClipTimesCommit={onClipTimesCommit}
              compact
              onOpenVerticalCropModal={(clipId) => {
                onSelectClip(clipId);
                setVerticalCropModalClipId(clipId);
              }}
              onToggleClipSubtitle={onToggleClipSubtitle}
              onOpenSyndication={
                (syndicationYoutubeEnabled ||
                  syndicationTwitterEnabled ||
                  syndicationFacebookEnabled ||
                  syndicationInstagramEnabled ||
                  syndicationTiktokEnabled) &&
                syndicationTenantId.trim()
                  ? (c) => setSyndicationClipId(c.id)
                  : undefined
              }
              onUpdateClipTitle={(clipId, title) => onUpdateClipMetadata(clipId, { title })}
              onCaptureClipPoster={onCaptureClipPoster}
              onAddTextWidget={onAddTextWidget}
              onAddImageWidgetFromFile={onAddImageWidgetFromFile}
              realtimeTranscriptUi={realtimeTranscriptUi}
              vodJobs={vodJobs}
              clipVodEncodeErrors={clipVodEncodeErrors}
              onClipStartVodEncode={onClipStartVodEncode}
              onClipCancelVodEncode={onClipCancelVodEncode}
              onVodJobsRefresh={onVodJobsRefresh}
            />
            {selectionMode !== "realtime" &&
            onSelectAd &&
            onRemoveAd &&
            onAdOrderChange &&
            onAdTimesCommit ? (
              <div className="border-t border-secondary pt-3">
                <EditorAdsList
                  ads={ads}
                  clipUrl={clipUrl}
                  channelId={channelId}
                  parentWindowDurationSec={parentWindowDurationSec}
                  selectedAdId={selectedAdId}
                  onSelectAd={onSelectAd}
                  onRemoveAd={onRemoveAd}
                  onAdOrderChange={onAdOrderChange}
                  onAdTimesCommit={onAdTimesCommit}
                  onSeek={onSeek}
                  thumbnailsEnabled={thumbnailsEnabled}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2 border-t border-secondary pt-3">
          <MenuTrigger>
            <AriaButton
              aria-label="Add clip or ad slot"
              className={({ isPressed, isFocusVisible }) =>
                cx(
                  "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-brand bg-brand-solid text-white shadow-md transition-colors hover:bg-brand-solid-hover",
                  (isPressed || isFocusVisible) && "outline-2 outline-offset-2 outline-focus-ring",
                )
              }
            >
              <Plus className="size-5" strokeWidth={2} aria-hidden />
            </AriaButton>
            <AriaPopover
              placement="top"
              offset={8}
              className={({ isEntering, isExiting }) =>
                cx(
                  "will-change-transform",
                  isEntering &&
                    "duration-200 ease-out animate-in fade-in placement-top:slide-in-from-bottom-2 placement-bottom:slide-in-from-top-2",
                  isExiting &&
                    "duration-150 ease-in animate-out fade-out placement-top:slide-out-to-bottom-2 placement-bottom:slide-out-to-top-2",
                )
              }
            >
              <Menu
                className="min-w-56 rounded-lg border border-secondary_alt bg-primary p-1 shadow-lg outline-none"
                onAction={(key) => {
                  if (key === "add-vertical") onAddVerticalClip();
                  if (key === "add-horizontal") onAddHorizontalClip();
                  if (key === "add-ad") onAddAdSlot?.();
                }}
              >
                <MenuItem
                  id="add-vertical"
                  className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                >
                  Add Vertical Clip
                </MenuItem>
                <MenuItem
                  id="add-horizontal"
                  className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                >
                  Add Horizontal Clip
                </MenuItem>
                <MenuItem
                  id="add-ad"
                  isDisabled={addAdSlotDisabled || !onAddAdSlot}
                  className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                >
                  Add Ad Slot
                </MenuItem>
              </Menu>
            </AriaPopover>
          </MenuTrigger>
        </div>
      </section>

      <EditorClipMetadataModal
        isOpen={clipForMetadata !== null}
        onOpenChange={(open) => {
          if (!open) setClipMetadataId(null);
        }}
        clip={clipForMetadata}
        clipUrl={clipUrl}
        channelId={channelId}
        onSave={onUpdateClipMetadata}
        onSeek={onSeek}
        readOnly={clipMetadataReadOnly}
      />

      <EditorSyndicationModal
        isOpen={clipForSyndication !== null}
        onOpenChange={(open) => {
          if (!open) setSyndicationClipId(null);
        }}
        tenantId={syndicationTenantId.trim()}
        clip={clipForSyndication}
        clipUrl={clipUrl}
        channelId={channelId}
        readOnly={syndicationReadOnly}
        onSave={onUpdateClipSyndication}
      />

      {onSaveVerticalCropFromModal ? (
        <EditorVerticalCropBreakpointsModal
          isOpen={clipForVerticalCropModal !== null}
          onOpenChange={(open) => {
            if (!open) setVerticalCropModalClipId(null);
          }}
          clip={clipForVerticalCropModal}
          readOnly={verticalCropModalReadOnly}
          onSave={onSaveVerticalCropFromModal}
        />
      ) : null}
    </div>
  );
}
