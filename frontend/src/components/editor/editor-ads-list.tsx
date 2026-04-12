import { useCallback, useState } from "react";
import { Play, Trash01 } from "@untitledui/icons";
import type { EditorAdMarker } from "@/types/editor";
import { buildThumbnailUrl } from "./editor-constants";
import { formatTime } from "./editor-timeline";

const ROW_HEIGHT_COMPACT = 44;
const THUMB_HEIGHT_COMPACT = 28;

interface EditorAdsListProps {
  ads: EditorAdMarker[];
  clipUrl: string;
  channelId: string;
  selectedAdId: string | null;
  onSelectAd: (id: string | null) => void;
  onRemoveAd: (id: string) => void;
  onAdOrderChange: (id: string, newIndex: number) => void;
  onSeek?: (timeSeconds: number) => void;
  thumbnailsEnabled?: boolean;
  emptyHint?: string;
}

export function EditorAdsList({
  ads,
  clipUrl,
  channelId,
  selectedAdId,
  onSelectAd,
  onRemoveAd,
  onAdOrderChange,
  onSeek,
  thumbnailsEnabled = true,
  emptyHint = "Add slots from Actions or they appear when detected.",
}: EditorAdsListProps) {
  const rowHeight = ROW_HEIGHT_COMPACT;
  const thumbHeight = THUMB_HEIGHT_COMPACT;
  const thumbWidth = Math.round(thumbHeight * (16 / 9));
  const sortedAds = [...ads].sort((a, b) => a.index - b.index);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const handleOrderFocus = useCallback((a: EditorAdMarker) => {
    setEditingId(a.id);
    setEditingValue(String(a.index));
  }, []);

  const handleOrderBlur = useCallback(
    (id: string, value: string) => {
      const n = parseInt(value, 10);
      if (!Number.isNaN(n) && n >= 1) onAdOrderChange(id, n);
      setEditingId(null);
    },
    [onAdOrderChange],
  );

  if (ads.length === 0) {
    return (
      <div className="rounded-lg border border-secondary bg-secondary px-3 py-2 text-xs text-tertiary">
        No ad slots. {emptyHint}
      </div>
    );
  }

  const tw = thumbWidth;
  const th = thumbHeight;
  const thumbPlaceholder = (label: string) => (
    <div className="flex size-full items-center justify-center bg-quaternary text-[9px] font-medium text-tertiary">
      {label}
    </div>
  );

  return (
    <div className="flex flex-col gap-1">
      <p className="shrink-0 text-xs font-medium text-secondary">ADS</p>
      <ul className="flex flex-col gap-1">
        {sortedAds.map((a) => {
          const isEditing = editingId === a.id;
          const isSelected = selectedAdId === a.id;
          const thumbInUrl = buildThumbnailUrl(clipUrl, a.startTime, channelId);
          const thumbOutUrl = buildThumbnailUrl(clipUrl, a.endTime, channelId);
          const handleRowClick = () => {
            if (isSelected) {
              onSelectAd(null);
            } else {
              onSelectAd(a.id);
              onSeek?.(a.startTime);
            }
          };
          return (
            <li
              key={a.id}
              data-editor-ad-focus
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
              <div
                className="shrink-0 overflow-hidden rounded border border-secondary bg-quaternary"
                style={{ width: tw, height: th }}
                onClick={(e) => e.stopPropagation()}
              >
                {thumbnailsEnabled ? (
                  <img
                    src={thumbInUrl}
                    alt=""
                    className="size-full object-cover"
                    width={tw}
                    height={th}
                    loading="lazy"
                  />
                ) : (
                  thumbPlaceholder("In")
                )}
              </div>
              <div
                className="shrink-0 overflow-hidden rounded border border-secondary bg-quaternary"
                style={{ width: tw, height: th }}
                onClick={(e) => e.stopPropagation()}
              >
                {thumbnailsEnabled ? (
                  <img
                    src={thumbOutUrl}
                    alt=""
                    className="size-full object-cover"
                    width={tw}
                    height={th}
                    loading="lazy"
                  />
                ) : (
                  thumbPlaceholder("Out")
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek?.(a.startTime);
                }}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-secondary bg-primary text-fg-secondary transition-colors hover:bg-secondary"
                aria-label="Seek to ad start"
              >
                <Play className="size-4" />
              </button>
              <span className="min-w-0 max-w-full shrink text-[10px] leading-tight text-brand-secondary">
                AD #{a.index} · {formatTime(a.startTime)} → {formatTime(a.endTime)}
              </span>
              <label
                className="flex shrink-0 items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-[10px] text-tertiary">#</span>
                <input
                  type="number"
                  min={1}
                  value={isEditing ? editingValue : a.index}
                  onChange={(e) => isEditing && setEditingValue(e.target.value)}
                  onFocus={() => handleOrderFocus(a)}
                  onBlur={() => handleOrderBlur(a.id, isEditing ? editingValue : String(a.index))}
                  className="w-8 rounded border border-secondary bg-primary px-1 py-0.5 text-[10px] text-primary"
                />
              </label>
              {isSelected ? (
                <span className="shrink-0 text-[10px] font-medium uppercase text-brand-solid">
                  Editing
                </span>
              ) : null}
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveAd(a.id);
                    if (selectedAdId === a.id) onSelectAd(null);
                  }}
                  className="rounded p-1 text-fg-quaternary hover:bg-tertiary hover:text-fg-secondary"
                  aria-label="Remove ad slot"
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
