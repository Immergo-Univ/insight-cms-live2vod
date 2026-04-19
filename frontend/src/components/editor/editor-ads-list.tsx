import { useCallback, useEffect, useState } from "react";
import { Play, Trash01 } from "@untitledui/icons";
import type { EditorAdMarker } from "@/types/editor";
import { cx } from "@/utils/cx";
import { buildThumbnailUrl, FRAME_DURATION_SEC } from "./editor-constants";
import {
  clampClipTimeRange,
  filterRelativeTimeTyping,
  formatDigitsAsMaskedRelativeTime,
  formatTime,
  parseRelativeTimeInput,
} from "./editor-timeline";

const ROW_HEIGHT_COMPACT = 44;
const THUMB_HEIGHT_COMPACT = 28;

/** In / out thumbnails with mark-in / mark-out inputs (same behavior as clip rows). */
function AdThumbsWithRangeFields({
  adId,
  startTime,
  endTime,
  maxDuration,
  onCommit,
  thumbInUrl,
  thumbOutUrl,
  thumbW,
  thumbH,
  thumbnailsEnabled,
}: {
  adId: string;
  startTime: number;
  endTime: number;
  maxDuration: number;
  onCommit: (
    adId: string,
    start: number,
    end: number,
  ) => { startTime: number; endTime: number } | null;
  thumbInUrl: string;
  thumbOutUrl: string;
  thumbW: number;
  thumbH: number;
  thumbnailsEnabled: boolean;
}) {
  const compact = true;
  const [startStr, setStartStr] = useState(() => formatTime(startTime));
  const [endStr, setEndStr] = useState(() => formatTime(endTime));

  useEffect(() => {
    setStartStr(formatTime(startTime));
    setEndStr(formatTime(endTime));
  }, [adId, startTime, endTime]);

  const timePlaceholder = maxDuration >= 3600 ? "h:mm:ss" : "m:ss";
  const timeTitle =
    maxDuration >= 3600
      ? "Time as h:mm:ss, or type digits only (e.g. 10105 → 1:01:05). Two digits alone = total seconds."
      : "Time as m:ss, or type digits only (e.g. 130 → 1:30). One or two digits = total seconds.";

  const inputClass = cx(
    "w-full min-w-0 rounded border border-secondary px-0.5 py-0.5 text-center text-brand-secondary tabular-nums outline-none placeholder:text-placeholder",
    "bg-primary focus:border-brand focus:ring-1 focus:ring-brand-secondary/30",
    compact ? "text-[9px]" : "text-[10px]",
  );

  const thumbPlaceholder = (label: string) => (
    <div className="flex size-full items-center justify-center bg-quaternary text-[9px] font-medium text-tertiary">
      {label}
    </div>
  );

  const handleMaskedChange = (raw: string, setStr: (s: string) => void) => {
    const filtered = filterRelativeTimeTyping(raw);
    if (filtered.includes(":")) {
      setStr(filtered);
      return;
    }
    setStr(formatDigitsAsMaskedRelativeTime(filtered, maxDuration));
  };

  const commit = () => {
    const a = parseRelativeTimeInput(startStr);
    const b = parseRelativeTimeInput(endStr);
    if (a === null || b === null) {
      setStartStr(formatTime(startTime));
      setEndStr(formatTime(endTime));
      return;
    }
    const r = clampClipTimeRange(a, b, maxDuration, FRAME_DURATION_SEC);
    if (!r) {
      setStartStr(formatTime(startTime));
      setEndStr(formatTime(endTime));
      return;
    }
    const applied = onCommit(adId, r.startTime, r.endTime);
    if (applied) {
      setStartStr(formatTime(applied.startTime));
      setEndStr(formatTime(applied.endTime));
    } else {
      setStartStr(formatTime(startTime));
      setEndStr(formatTime(endTime));
    }
  };

  return (
    <div className="flex shrink-0 gap-1">
      <div className="flex flex-col items-stretch gap-0.5" style={{ width: thumbW }}>
        <div
          className="shrink-0 cursor-pointer overflow-hidden rounded border border-secondary bg-quaternary"
          style={{ width: thumbW, height: thumbH }}
        >
          {thumbnailsEnabled ? (
            <img
              src={thumbInUrl}
              alt="In"
              className="pointer-events-none size-full object-cover"
              width={thumbW}
              height={thumbH}
              loading="lazy"
              draggable={false}
            />
          ) : (
            thumbPlaceholder("In")
          )}
        </div>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          data-no-row-select
          className={inputClass}
          aria-label="Ad slot mark-in time"
          placeholder={timePlaceholder}
          title={timeTitle}
          value={startStr}
          onChange={(e) => handleMaskedChange(e.target.value, setStartStr)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="flex flex-col items-stretch gap-0.5" style={{ width: thumbW }}>
        <div
          className="shrink-0 cursor-pointer overflow-hidden rounded border border-secondary bg-quaternary"
          style={{ width: thumbW, height: thumbH }}
        >
          {thumbnailsEnabled ? (
            <img
              src={thumbOutUrl}
              alt="Out"
              className="pointer-events-none size-full object-cover"
              width={thumbW}
              height={thumbH}
              loading="lazy"
              draggable={false}
            />
          ) : (
            thumbPlaceholder("Out")
          )}
        </div>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          data-no-row-select
          className={inputClass}
          aria-label="Ad slot mark-out time"
          placeholder={timePlaceholder}
          title={timeTitle}
          value={endStr}
          onChange={(e) => handleMaskedChange(e.target.value, setEndStr)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
    </div>
  );
}

interface EditorAdsListProps {
  ads: EditorAdMarker[];
  clipUrl: string;
  channelId: string;
  /** Parent window length for parsing / clamping in/out (same as clips list). */
  parentWindowDurationSec: number;
  selectedAdId: string | null;
  onSelectAd: (id: string | null) => void;
  onRemoveAd: (id: string) => void;
  onAdOrderChange: (id: string, newIndex: number) => void;
  onAdTimesCommit: (
    adId: string,
    startTime: number,
    endTime: number,
  ) => { startTime: number; endTime: number } | null;
  onSeek?: (timeSeconds: number) => void;
  thumbnailsEnabled?: boolean;
  emptyHint?: string;
}

export function EditorAdsList({
  ads,
  clipUrl,
  channelId,
  parentWindowDurationSec,
  selectedAdId,
  onSelectAd,
  onRemoveAd,
  onAdOrderChange,
  onAdTimesCommit,
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
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-no-row-select]")) return;
                handleRowClick();
              }}
              onKeyDown={(e) => {
                if ((e.target as HTMLElement).closest("[data-no-row-select]")) return;
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
              <AdThumbsWithRangeFields
                adId={a.id}
                startTime={a.startTime}
                endTime={a.endTime}
                maxDuration={parentWindowDurationSec}
                onCommit={onAdTimesCommit}
                thumbInUrl={thumbInUrl}
                thumbOutUrl={thumbOutUrl}
                thumbW={tw}
                thumbH={th}
                thumbnailsEnabled={thumbnailsEnabled}
              />
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
                AD #{a.index}
              </span>
              <label
                className="flex shrink-0 items-center gap-0.5"
                data-no-row-select
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
