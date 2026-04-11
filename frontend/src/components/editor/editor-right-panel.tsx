import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Play } from "@untitledui/icons";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import type { EditorSelectionMode, EditorSubClip, EditorVodMetadata } from "@/types/editor";
import { cx } from "@/utils/cx";
import { EditorClipMetadataModal } from "./editor-clip-metadata-modal";
import { EditorClipsList } from "./editor-clips-list";
import { EditorMetadataModal } from "./editor-metadata-modal";

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

function formatUnixSecWallClock(unixSec: number, timeZone: string): string {
  let fmt = wallClockFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(undefined, {
      timeZone,
      dateStyle: "medium",
      timeStyle: "medium",
    });
    wallClockFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(unixSec * 1000));
}

interface EditorRightPanelProps {
  channelTitle: string;
  selectionMode: EditorSelectionMode;
  windowStartUnixSec: number;
  /** For EPG / time picker: fixed end. For realtime: ignored; end is derived from session duration. */
  windowEndUnixSec: number;
  /** Editor timeline duration in seconds (realtime session length on the timeline). */
  timelineDurationSec: number;
  timeZone: string;
  metadata: EditorVodMetadata;
  onMetadataChange: (next: EditorVodMetadata) => void;
  clips: EditorSubClip[];
  clipUrl: string;
  channelId: string;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  playingClipId: string | null;
  isPlaying: boolean;
  onPlaySubclip: (clip: EditorSubClip) => void;
  onPause: () => void;
  onOrderChange: (id: string, newOrder: number) => void;
  onRemoveClip: (id: string) => void;
  onUpdateClipMetadata: (
    clipId: string,
    patch: Pick<EditorSubClip, "title" | "description" | "posters">,
  ) => void;
  onSeek: (timeSeconds: number) => void;
  onPlayFullSequence: () => void;
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
}

/**
 * Right sidebar: session summary (channel + window), editable VOD metadata modal, sub-clips list.
 */
export function EditorRightPanel({
  channelTitle,
  selectionMode,
  windowStartUnixSec,
  windowEndUnixSec,
  timelineDurationSec,
  timeZone,
  metadata,
  onMetadataChange,
  clips,
  clipUrl,
  channelId,
  selectedClipId,
  onSelectClip,
  playingClipId,
  isPlaying,
  onPlaySubclip,
  onPause,
  onOrderChange,
  onRemoveClip,
  onUpdateClipMetadata,
  onSeek,
  onPlayFullSequence,
  thumbnailsEnabled,
  clipsEmptyHint,
  realtimeWallClock,
  onAddAdSlot,
  addAdSlotDisabled = false,
  onCreateWithoutAds,
  onCreateWithAds,
  finishLoading = false,
  finishError = null,
}: EditorRightPanelProps) {
  const [metadataModalOpen, setMetadataModalOpen] = useState(false);
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

  const timeRangeLabel = useMemo(() => {
    const tz = timeZone;
    if (selectionMode === "realtime") {
      const start = windowStartUnixSec;
      const end = start + Math.max(0, timelineDurationSec);
      return `${formatUnixSecWallClock(start, tz)} → ${formatUnixSecWallClock(end, tz)}`;
    }
    return `${formatUnixSecWallClock(windowStartUnixSec, tz)} → ${formatUnixSecWallClock(windowEndUnixSec, tz)}`;
  }, [
    selectionMode,
    windowStartUnixSec,
    windowEndUnixSec,
    timelineDurationSec,
    timeZone,
  ]);

  const channelLabel = channelTitle.trim() || "Channel";
  const titlePreview = metadata.title.trim() || "Add title, description & tags…";

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 bg-primary">
      <button
        type="button"
        onClick={() => setMetadataModalOpen(true)}
        className="flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-secondary bg-secondary px-3 py-3 text-left transition-colors hover:border-brand-solid/40 hover:bg-tertiary/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-solid"
      >
        <span className="text-xs font-semibold text-primary">{channelLabel}</span>
        <span className="text-[11px] leading-snug text-secondary">{timeRangeLabel}</span>
        <span className="mt-1 line-clamp-2 text-sm font-medium text-brand-secondary">{titlePreview}</span>
        <span className="text-[10px] text-tertiary">Click to edit title, description & tags</span>
      </button>

      <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex shrink-0 items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary">Clips</h3>
          <button
            type="button"
            onClick={onPlayFullSequence}
            disabled={clips.length === 0}
            title="Play full sequence (order 1 to N)"
            aria-label="Play full sequence"
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-secondary bg-primary text-fg-secondary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
          >
            <Play className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
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
            onOrderChange={onOrderChange}
            onRemove={onRemoveClip}
            onEditMetadata={(c) => setClipMetadataId(c.id)}
            onSeek={onSeek}
            thumbnailsEnabled={thumbnailsEnabled}
            emptyHint={clipsEmptyHint}
            realtimeWallClock={realtimeWallClock}
            compact
          />
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

      <EditorMetadataModal
        isOpen={metadataModalOpen}
        onOpenChange={setMetadataModalOpen}
        metadata={metadata}
        onSave={onMetadataChange}
      />

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
