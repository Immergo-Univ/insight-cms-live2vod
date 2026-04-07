import { useMemo, useState } from "react";
import { Play } from "@untitledui/icons";
import type { EditorSelectionMode, EditorSubClip, EditorVodMetadata } from "@/types/editor";
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
  onSeek: (timeSeconds: number) => void;
  onPlayFullSequence: () => void;
  thumbnailsEnabled: boolean;
  clipsEmptyHint: string;
  realtimeWallClock?: {
    sessionStartUnixSec: number;
    timeZone: string;
  };
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
  onSeek,
  onPlayFullSequence,
  thumbnailsEnabled,
  clipsEmptyHint,
  realtimeWallClock,
}: EditorRightPanelProps) {
  const [metadataModalOpen, setMetadataModalOpen] = useState(false);

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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
            onSeek={onSeek}
            thumbnailsEnabled={thumbnailsEnabled}
            emptyHint={clipsEmptyHint}
            realtimeWallClock={realtimeWallClock}
            compact
          />
        </div>
      </section>

      <EditorMetadataModal
        isOpen={metadataModalOpen}
        onOpenChange={setMetadataModalOpen}
        metadata={metadata}
        onSave={onMetadataChange}
      />
    </div>
  );
}
