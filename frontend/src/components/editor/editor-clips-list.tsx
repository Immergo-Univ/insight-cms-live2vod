import { useCallback, useState } from "react";
import { Edit01, Play, StopCircle, Trash01 } from "@untitledui/icons";
import type { EditorSubClip } from "@/types/editor";
import { buildThumbnailUrl } from "./editor-constants";
import { formatTime } from "./editor-timeline";

const ROW_HEIGHT_DEFAULT = 50;
const ROW_HEIGHT_COMPACT = 44;

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

const THUMB_HEIGHT_DEFAULT = 36;
const THUMB_HEIGHT_COMPACT = 28;

interface EditorClipsListProps {
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
  onRemove: (id: string) => void;
  onEditMetadata?: (clip: EditorSubClip) => void;
  onSeek?: (timeSeconds: number) => void;
  /** When false, skip VOD thumbnail URLs (e.g. live / realtime session offsets). */
  thumbnailsEnabled?: boolean;
  emptyHint?: string;
  /**
   * Realtime: sub-clip start/end are seconds after session start.
   * Show mark in/out as wall-clock times in this IANA zone (e.g. from ?tz=).
   */
  realtimeWallClock?: {
    sessionStartUnixSec: number;
    timeZone: string;
  };
  /** Narrow sidebar layout (smaller thumbs, tighter row). */
  compact?: boolean;
}

export function EditorClipsList({
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
  onRemove,
  onEditMetadata,
  onSeek,
  thumbnailsEnabled = true,
  emptyHint = "Use Mark In / Mark Out to add ranges.",
  realtimeWallClock,
  compact = false,
}: EditorClipsListProps) {
  const rowHeight = compact ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_DEFAULT;
  const thumbHeight = compact ? THUMB_HEIGHT_COMPACT : THUMB_HEIGHT_DEFAULT;
  const thumbWidth = Math.round(thumbHeight * (16 / 9));
  const sortedClips = [...clips].sort((a, b) => a.order - b.order);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const handleOrderFocus = useCallback((c: EditorSubClip) => {
    setEditingId(c.id);
    setEditingValue(String(c.order));
  }, []);

  const handleOrderBlur = useCallback(
    (id: string, value: string) => {
      const n = parseInt(value, 10);
      if (!Number.isNaN(n) && n >= 1) onOrderChange(id, n);
      setEditingId(null);
    },
    [onOrderChange]
  );

  if (clips.length === 0) {
    return (
      <div className="rounded-lg border border-secondary bg-secondary px-3 py-2 text-xs text-tertiary">
        No sub-clips. {emptyHint}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="shrink-0 text-xs font-medium text-secondary">Sub-clips (output order)</p>
      <ul className="flex flex-col gap-1">
        {sortedClips.map((c) => {
          const isEditing = editingId === c.id;
          const isSelected = selectedClipId === c.id;
          const isThisPlaying = playingClipId === c.id && isPlaying;
          const handleRowClick = () => {
            if (isSelected) {
              onSelectClip(null);
            } else {
              onSelectClip(c.id);
              onSeek?.(c.startTime);
            }
          };
          const thumbInUrl = buildThumbnailUrl(clipUrl, c.startTime, channelId);
          const thumbOutUrl = buildThumbnailUrl(clipUrl, c.endTime, channelId);
          const tw = thumbWidth;
          const th = thumbHeight;
          const thumbPlaceholder = (label: string) => (
            <div className="flex size-full items-center justify-center bg-quaternary text-[9px] font-medium text-tertiary">
              {label}
            </div>
          );
          return (
            <li
              key={c.id}
              data-editor-subclip-focus
              role="button"
              tabIndex={0}
              onClick={handleRowClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleRowClick();
                }
              }}
              className={`flex flex-wrap items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors sm:flex-nowrap sm:gap-2 sm:px-2 ${
                isSelected
                  ? "border-brand-solid bg-brand-solid/10"
                  : "border-secondary bg-secondary hover:bg-tertiary/50"
              }`}
              style={{ minHeight: rowHeight }}
            >
              {/* 1. Thumbnail Mark In */}
              <div
                className="shrink-0 overflow-hidden rounded border border-secondary bg-quaternary"
                style={{ width: tw, height: th }}
                onClick={(e) => e.stopPropagation()}
              >
                {thumbnailsEnabled ? (
                  <img
                    src={thumbInUrl}
                    alt="In"
                    className="size-full object-cover"
                    width={tw}
                    height={th}
                    loading="lazy"
                  />
                ) : (
                  thumbPlaceholder("In")
                )}
              </div>
              {/* 2. Thumbnail Mark Out */}
              <div
                className="shrink-0 overflow-hidden rounded border border-secondary bg-quaternary"
                style={{ width: tw, height: th }}
                onClick={(e) => e.stopPropagation()}
              >
                {thumbnailsEnabled ? (
                  <img
                    src={thumbOutUrl}
                    alt="Out"
                    className="size-full object-cover"
                    width={tw}
                    height={th}
                    loading="lazy"
                  />
                ) : (
                  thumbPlaceholder("Out")
                )}
              </div>
              {/* 3. Play / Stop */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isThisPlaying) onPause();
                  else onPlaySubclip(c);
                }}
                className={`flex shrink-0 items-center justify-center rounded-lg border border-secondary bg-primary text-fg-secondary transition-colors hover:bg-secondary ${compact ? "size-7" : "size-8"}`}
                aria-label={isThisPlaying ? "Stop" : "Play"}
              >
                {isThisPlaying ? (
                  <StopCircle className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </button>
              {/* 4. Time from – Time to */}
              <span
                className={`min-w-0 max-w-full shrink leading-tight text-brand-secondary ${compact ? "text-[10px]" : "text-xs"}`}
              >
                {realtimeWallClock
                  ? `${formatUnixSecWallClock(
                      realtimeWallClock.sessionStartUnixSec + c.startTime,
                      realtimeWallClock.timeZone,
                    )} → ${formatUnixSecWallClock(
                      realtimeWallClock.sessionStartUnixSec + c.endTime,
                      realtimeWallClock.timeZone,
                    )}`
                  : `${formatTime(c.startTime)} → ${formatTime(c.endTime)}`}
              </span>
              {/* Order (compact) */}
              <label
                className="flex shrink-0 items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-[10px] text-tertiary">#</span>
                <input
                  type="number"
                  min={1}
                  value={isEditing ? editingValue : c.order}
                  onChange={(e) => isEditing && setEditingValue(e.target.value)}
                  onFocus={() => handleOrderFocus(c)}
                  onBlur={() => handleOrderBlur(c.id, isEditing ? editingValue : String(c.order))}
                  className="w-8 rounded border border-secondary bg-primary px-1 py-0.5 text-[10px] text-primary"
                />
              </label>
              {isSelected && (
                <span className="shrink-0 text-[10px] font-medium uppercase text-brand-solid">
                  Editing
                </span>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                {onEditMetadata ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditMetadata(c);
                    }}
                    className="rounded p-1 text-fg-quaternary hover:bg-tertiary hover:text-fg-secondary"
                    aria-label="Edit clip metadata"
                  >
                    <Edit01 className="size-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(c.id);
                    if (selectedClipId === c.id) onSelectClip(null);
                  }}
                  className="rounded p-1 text-fg-quaternary hover:bg-tertiary hover:text-fg-secondary"
                  aria-label="Remove sub-clip"
                >
                  <Trash01 className="size-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
