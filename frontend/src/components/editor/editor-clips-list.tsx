import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Camera01, Edit01, Play, StopCircle, Trash01 } from "@untitledui/icons";
import type { EditorSubClip } from "@/types/editor";
import { cx } from "@/utils/cx";
import { buildThumbnailUrl, FRAME_DURATION_SEC } from "./editor-constants";
import { EditorSubtitleButton } from "./editor-subtitle-button";
import { EditorVerticalCropButton } from "./editor-vertical-crop-button";
import {
  clampClipTimeRange,
  filterRelativeTimeTyping,
  formatDigitsAsMaskedRelativeTime,
  formatTime,
  parseRelativeTimeInput,
} from "./editor-timeline";

const THUMB_HEIGHT_DEFAULT = 36;
const THUMB_HEIGHT_COMPACT = 28;

/** Same cap as metadata modal. */
const CLIP_TITLE_MAX_LEN = 255;

/** In / out thumbnails with mark-in / mark-out inputs stacked under each (saves horizontal row space). */
function ClipThumbsWithRangeFields({
  clipId,
  startTime,
  endTime,
  maxDuration,
  compact,
  onCommit,
  thumbInUrl,
  thumbOutUrl,
  thumbW,
  thumbH,
  thumbnailsEnabled,
}: {
  clipId: string;
  startTime: number;
  endTime: number;
  maxDuration: number;
  compact: boolean;
  onCommit: (
    clipId: string,
    start: number,
    end: number,
  ) => { startTime: number; endTime: number } | null;
  thumbInUrl: string;
  thumbOutUrl: string;
  thumbW: number;
  thumbH: number;
  thumbnailsEnabled: boolean;
}) {
  const [startStr, setStartStr] = useState(() => formatTime(startTime));
  const [endStr, setEndStr] = useState(() => formatTime(endTime));

  useEffect(() => {
    setStartStr(formatTime(startTime));
    setEndStr(formatTime(endTime));
  }, [clipId, startTime, endTime]);

  const timePlaceholder = maxDuration >= 3600 ? "h:mm:ss" : "m:ss";
  const timeTitle =
    maxDuration >= 3600
      ? "Time as h:mm:ss, or type digits only (e.g. 10105 → 1:01:05). Two digits alone = total seconds."
      : "Time as m:ss, or type digits only (e.g. 130 → 1:30). One or two digits = total seconds.";

  const inputClass = cx(
    "w-full min-w-0 rounded border border-secondary bg-primary px-0.5 py-0.5 text-center text-brand-secondary tabular-nums outline-none placeholder:text-placeholder focus:border-brand focus:ring-1 focus:ring-brand-secondary/30",
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
    const applied = onCommit(clipId, r.startTime, r.endTime);
    if (applied) {
      setStartStr(formatTime(applied.startTime));
      setEndStr(formatTime(applied.endTime));
    } else {
      setStartStr(formatTime(startTime));
      setEndStr(formatTime(endTime));
    }
  };

  return (
    <div className="flex shrink-0 gap-1" data-no-row-select onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-col items-stretch gap-0.5" style={{ width: thumbW }}>
        <div
          className="shrink-0 overflow-hidden rounded border border-secondary bg-quaternary"
          style={{ width: thumbW, height: thumbH }}
        >
          {thumbnailsEnabled ? (
            <img
              src={thumbInUrl}
              alt="In"
              className="size-full object-cover"
              width={thumbW}
              height={thumbH}
              loading="lazy"
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
          className={inputClass}
          aria-label="Clip mark-in time"
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
          className="shrink-0 overflow-hidden rounded border border-secondary bg-quaternary"
          style={{ width: thumbW, height: thumbH }}
        >
          {thumbnailsEnabled ? (
            <img
              src={thumbOutUrl}
              alt="Out"
              className="size-full object-cover"
              width={thumbW}
              height={thumbH}
              loading="lazy"
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
          className={inputClass}
          aria-label="Clip mark-out time"
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
  onRemove: (id: string) => void;
  onEditMetadata?: (clip: EditorSubClip) => void;
  onSeek?: (timeSeconds: number) => void;
  /** When false, skip VOD thumbnail URLs (e.g. live / realtime session offsets). */
  thumbnailsEnabled?: boolean;
  emptyHint?: string;
  /** Narrow sidebar layout (smaller thumbs, tighter row). */
  compact?: boolean;
  onToggleClipVerticalCrop?: (clipId: string) => void;
  onToggleClipSubtitle?: (clipId: string) => void;
  /** Max time (seconds) in the parent window; used to clamp edited in/out. */
  parentWindowDurationSec: number;
  /** Apply parsed range; return applied range or null if unchanged / rejected. */
  onClipTimesCommit: (
    clipId: string,
    startTime: number,
    endTime: number,
  ) => { startTime: number; endTime: number } | null;
  /** Persist clip title from inline edit (row). */
  onUpdateClipTitle: (clipId: string, title: string) => void;
  /** Bookmark current playhead time as a poster capture on this clip. */
  onCaptureClipPoster?: (clipId: string) => void;
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
  onRemove,
  onEditMetadata,
  onSeek,
  thumbnailsEnabled = true,
  emptyHint = "Use Mark In / Mark Out to add ranges.",
  compact = false,
  onToggleClipVerticalCrop,
  onToggleClipSubtitle,
  parentWindowDurationSec,
  onClipTimesCommit,
  onUpdateClipTitle,
  onCaptureClipPoster,
}: EditorClipsListProps) {
  const thumbHeight = compact ? THUMB_HEIGHT_COMPACT : THUMB_HEIGHT_DEFAULT;
  const thumbWidth = Math.round(thumbHeight * (16 / 9));

  const [titleEditId, setTitleEditId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!titleEditId) return;
    const el = titleInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [titleEditId]);

  useEffect(() => {
    if (titleEditId && !clips.some((c) => c.id === titleEditId)) {
      setTitleEditId(null);
    }
  }, [clips, titleEditId]);

  const commitTitleEdit = useCallback(
    (clipId: string) => {
      if (titleEditId !== clipId) return;
      const next = titleDraft.slice(0, CLIP_TITLE_MAX_LEN).trim();
      onUpdateClipTitle(clipId, next);
      setTitleEditId(null);
    },
    [titleEditId, titleDraft, onUpdateClipTitle],
  );

  const cancelTitleEdit = useCallback(() => {
    setTitleEditId(null);
  }, []);

  const handleRemove = useCallback(
    (id: string) => {
      onRemove(id);
      if (selectedClipId === id) onSelectClip(null);
    },
    [onRemove, onSelectClip, selectedClipId],
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
      <p className="shrink-0 text-xs font-medium text-secondary">Clips</p>
      <ul className="flex flex-col gap-1">
        {clips.map((c) => {
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
          const posterCount = c.posters?.length ?? 0;
          return (
            <li
              key={c.id}
              data-editor-subclip-focus
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
              className={`flex cursor-pointer flex-wrap items-start gap-2 rounded-lg border px-1.5 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary/40 sm:flex-nowrap sm:px-2 ${
                isSelected
                  ? "border-brand-solid bg-brand-solid/10"
                  : "border-secondary bg-secondary hover:bg-tertiary/50"
              }`}
            >
              <ClipThumbsWithRangeFields
                clipId={c.id}
                startTime={c.startTime}
                endTime={c.endTime}
                maxDuration={parentWindowDurationSec}
                compact={compact}
                onCommit={onClipTimesCommit}
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
              <div
                className="flex min-w-0 flex-1 flex-col gap-1.5"
                data-no-row-select
                onClick={(e) => e.stopPropagation()}
              >
                {titleEditId === c.id ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    maxLength={CLIP_TITLE_MAX_LEN}
                    autoComplete="off"
                    className={cx(
                      "w-full min-w-0 rounded border border-secondary bg-primary px-2 py-2 font-medium text-primary outline-none focus:border-brand focus:ring-1 focus:ring-brand-secondary/40",
                      compact ? "text-[10px]" : "text-xs",
                    )}
                    aria-label="Clip title"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => commitTitleEdit(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        cancelTitleEdit();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={cx(
                      "w-full min-w-0 cursor-text truncate rounded border border-secondary bg-primary px-2 py-2 text-left font-semibold transition-colors hover:bg-tertiary/50",
                      c.title?.trim() ? "text-primary" : "text-tertiary italic",
                      compact ? "text-[10px]" : "text-xs",
                    )}
                    title="Click to edit title"
                    onClick={() => {
                      setTitleEditId(c.id);
                      setTitleDraft(c.title ?? "");
                    }}
                  >
                    {c.title?.trim() || "Add title"}
                  </button>
                )}
                <div className="flex shrink-0 flex-row flex-wrap items-center gap-1.5">
                  {onEditMetadata ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditMetadata(c);
                      }}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary transition-colors hover:bg-secondary hover:text-fg-secondary"
                      aria-label="Edit clip metadata"
                    >
                      <Edit01 className="size-3.5" />
                    </button>
                  ) : null}
                  {onToggleClipSubtitle ? (
                    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                      <EditorSubtitleButton
                        variant="inline"
                        active={!!c.subtitleMode}
                        onToggle={() => onToggleClipSubtitle(c.id)}
                      />
                    </span>
                  ) : null}
                  {onToggleClipVerticalCrop ? (
                    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                      <EditorVerticalCropButton
                        variant="inline"
                        active={!!c.verticalCropMode}
                        onToggle={() => onToggleClipVerticalCrop(c.id)}
                      />
                    </span>
                  ) : null}
                  {onCaptureClipPoster ? (
                    <span className="relative inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onCaptureClipPoster(c.id)}
                        className="flex size-8 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary transition-colors hover:bg-secondary hover:text-fg-secondary"
                        title="Capture poster at current playhead for this clip"
                        aria-label="Capture poster at current playhead for this clip"
                      >
                        <Camera01 className="size-3.5" aria-hidden />
                      </button>
                      {posterCount > 0 ? (
                        <span className="pointer-events-none absolute -top-1 -right-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-brand-solid px-0.5 text-[9px] font-bold leading-none text-white ring-2 ring-primary">
                          {posterCount > 99 ? "99+" : posterCount}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(c.id);
                    }}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary text-error-primary transition-colors hover:bg-error-secondary hover:text-error-primary"
                    aria-label="Remove sub-clip"
                  >
                    <Trash01 className="size-3.5" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
