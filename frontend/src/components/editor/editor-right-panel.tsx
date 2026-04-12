import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "@untitledui/icons";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import type { EditorAdMarker, EditorSelectionMode, EditorSubClip } from "@/types/editor";
import { cx } from "@/utils/cx";
import { EditorAdsList } from "./editor-ads-list";
import { EditorClipMetadataModal } from "./editor-clip-metadata-modal";
import { EditorClipsList } from "./editor-clips-list";

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
    patch: Pick<EditorSubClip, "title" | "description" | "posters">,
  ) => void;
  onSeek: (timeSeconds: number) => void;
  thumbnailsEnabled: boolean;
  clipsEmptyHint: string;
  realtimeWallClock?: {
    sessionStartUnixSec: number;
    timeZone: string;
  };
  /** Bottom bar: add ad slot (VOD timeline only) and create job with/without ads. */
  onAddAdSlot?: () => void;
  addAdSlotDisabled?: boolean;
  onCreateWithoutAds?: () => void;
  onCreateWithAds?: () => void;
  finishLoading?: boolean;
  finishError?: string | null;
  /** VOD timeline ad markers (EPG / time picker only). */
  ads?: EditorAdMarker[];
  selectedAdId?: string | null;
  onSelectAd?: (id: string | null) => void;
  onRemoveAd?: (id: string) => void;
  onAdOrderChange?: (id: string, newIndex: number) => void;
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
  onSeek,
  thumbnailsEnabled,
  clipsEmptyHint,
  realtimeWallClock,
  onAddAdSlot,
  addAdSlotDisabled = false,
  onCreateWithoutAds,
  onCreateWithAds,
  finishLoading = false,
  finishError = null,
  ads = [],
  selectedAdId = null,
  onSelectAd,
  onRemoveAd,
  onAdOrderChange,
}: EditorRightPanelProps) {
  const [clipMetadataId, setClipMetadataId] = useState<string | null>(null);

  const clipForMetadata = useMemo(
    () => (clipMetadataId ? clips.find((c) => c.id === clipMetadataId) ?? null : null),
    [clips, clipMetadataId],
  );

  useEffect(() => {
    if (clipMetadataId && !clips.some((c) => c.id === clipMetadataId)) {
      setClipMetadataId(null);
    }
  }, [clips, clipMetadataId]);

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
              realtimeWallClock={realtimeWallClock}
              compact
            />
            {selectionMode !== "realtime" &&
            onSelectAd &&
            onRemoveAd &&
            onAdOrderChange ? (
              <div className="border-t border-secondary pt-3">
                <EditorAdsList
                  ads={ads}
                  clipUrl={clipUrl}
                  channelId={channelId}
                  selectedAdId={selectedAdId}
                  onSelectAd={onSelectAd}
                  onRemoveAd={onRemoveAd}
                  onAdOrderChange={onAdOrderChange}
                  onSeek={onSeek}
                  thumbnailsEnabled={thumbnailsEnabled}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-secondary pt-3">
          {finishError ? (
            <p className="mb-2 text-xs text-error-primary">{finishError}</p>
          ) : null}
          <MenuTrigger>
            <AriaButton
              className={({ isPressed, isFocusVisible }) =>
                cx(
                  "flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-secondary",
                  (isPressed || isFocusVisible) && "outline-2 outline-offset-2 outline-focus-ring",
                  finishLoading && "cursor-not-allowed opacity-60",
                )
              }
              isDisabled={finishLoading}
            >
              Actions
              <ChevronDown data-icon className="size-4 text-fg-quaternary" aria-hidden />
            </AriaButton>
            <AriaPopover
              placement="top start"
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
                className="min-w-52 rounded-lg border border-secondary_alt bg-primary p-1 shadow-lg outline-none"
                onAction={(key) => {
                  if (key === "add-ad") onAddAdSlot?.();
                  if (key === "create-no-ads") onCreateWithoutAds?.();
                  if (key === "create-with-ads") onCreateWithAds?.();
                }}
              >
                <MenuItem
                  id="add-ad"
                  isDisabled={addAdSlotDisabled || !onAddAdSlot}
                  className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                >
                  Add new AD Slot
                </MenuItem>
                <MenuItem
                  id="create-no-ads"
                  isDisabled={!onCreateWithoutAds}
                  className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                >
                  Create without Ads
                </MenuItem>
                <MenuItem
                  id="create-with-ads"
                  isDisabled={!onCreateWithAds}
                  className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                >
                  Create with Ads
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
      />
    </div>
  );
}
