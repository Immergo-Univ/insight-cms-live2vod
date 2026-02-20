import { useCallback, useState } from "react";
import { Play, StopCircle, Trash01 } from "@untitledui/icons";
import type { EditorSubClip } from "@/types/editor";
import { buildThumbnailUrl } from "./editor-constants";
import { formatTime } from "./editor-timeline";

const ROW_HEIGHT = 50;
const THUMB_HEIGHT = 36;
const THUMB_WIDTH = Math.round(THUMB_HEIGHT * (16 / 9));

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
  onSeek?: (timeSeconds: number) => void;
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
  onSeek,
}: EditorClipsListProps) {
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
        No sub-clips. Use Mark In / Mark Out to add ranges.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <p className="shrink-0 text-xs font-medium text-secondary">Sub-clips (output order)</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
          return (
            <li
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={handleRowClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleRowClick();
                }
              }}
              className={`flex items-center gap-2 rounded-lg border px-2 transition-colors ${
                isSelected
                  ? "border-brand-solid bg-brand-solid/10"
                  : "border-secondary bg-secondary hover:bg-tertiary/50"
              }`}
              style={{ minHeight: ROW_HEIGHT, maxHeight: ROW_HEIGHT }}
            >
              {/* 1. Thumbnail Mark In */}
              <div
                className="shrink-0 overflow-hidden rounded border border-secondary bg-quaternary"
                style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={thumbInUrl}
                  alt="In"
                  className="size-full object-cover"
                  width={THUMB_WIDTH}
                  height={THUMB_HEIGHT}
                  loading="lazy"
                />
              </div>
              {/* 2. Thumbnail Mark Out */}
              <div
                className="shrink-0 overflow-hidden rounded border border-secondary bg-quaternary"
                style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={thumbOutUrl}
                  alt="Out"
                  className="size-full object-cover"
                  width={THUMB_WIDTH}
                  height={THUMB_HEIGHT}
                  loading="lazy"
                />
              </div>
              {/* 3. Play / Stop */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isThisPlaying) onPause();
                  else onPlaySubclip(c);
                }}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-secondary bg-primary text-fg-secondary transition-colors hover:bg-secondary"
                aria-label={isThisPlaying ? "Stop" : "Play"}
              >
                {isThisPlaying ? (
                  <StopCircle className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </button>
              {/* 4. Time from – Time to */}
              <span className="min-w-0 shrink font-mono text-xs text-brand-secondary">
                {formatTime(c.startTime)} → {formatTime(c.endTime)}
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
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(c.id);
                  if (selectedClipId === c.id) onSelectClip(null);
                }}
                className="ml-auto shrink-0 rounded p-1 text-fg-quaternary hover:bg-tertiary hover:text-fg-secondary"
                aria-label="Remove sub-clip"
              >
                <Trash01 className="size-3.5" />
              </button>
            </li>
          );
        })}
        </ul>
      </div>
    </div>
  );
}
