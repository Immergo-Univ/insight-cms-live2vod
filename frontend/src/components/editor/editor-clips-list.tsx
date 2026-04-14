import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Camera01, Clapperboard, Edit01, Play, StopCircle, Trash01 } from "@untitledui/icons";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import type { EditorSubClip } from "@/types/editor";
import type { VodJobRecord } from "@/types/vod-job";
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

function pickLatestJobForEditorClip(jobs: VodJobRecord[], clipId: string): VodJobRecord | undefined {
  let best: VodJobRecord | undefined;
  for (const j of jobs) {
    if (j.editorClipId !== clipId) continue;
    if (!best || j.createdAt > best.createdAt) best = j;
  }
  return best;
}

function vodJobIsActive(status: VodJobRecord["status"]): boolean {
  return (
    status === "queued" ||
    status === "processing" ||
    status === "uploading" ||
    status === "cancelling"
  );
}

function vodJobCanCancel(status: VodJobRecord["status"]): boolean {
  return vodJobIsActive(status);
}

function firstNonEmptyOutputUrl(job: VodJobRecord): string | null {
  const direct = job.outputUrl?.trim();
  if (direct) return direct;
  const fromList = job.outputUrls?.find((u) => typeof u === "string" && u.trim().length > 0);
  return fromList?.trim() ?? null;
}

/** Latest completed encode for this editor clip row with a public MP4 URL. */
function pickLatestCompletedOutputUrlForEditorClip(
  jobs: VodJobRecord[],
  clipId: string,
): string | null {
  const completed = jobs.filter((j) => j.editorClipId === clipId && j.status === "completed");
  completed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const j of completed) {
    const url = firstNonEmptyOutputUrl(j);
    if (url) return url;
  }
  return null;
}

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
  disabled = false,
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
  disabled?: boolean;
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
    "w-full min-w-0 rounded border border-secondary px-0.5 py-0.5 text-center text-brand-secondary tabular-nums outline-none placeholder:text-placeholder",
    disabled
      ? "cursor-not-allowed bg-secondary text-tertiary"
      : "bg-primary focus:border-brand focus:ring-1 focus:ring-brand-secondary/30",
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
    if (disabled) return;
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
    <div
      className={cx("flex shrink-0 gap-1", disabled && "opacity-60")}
      data-no-row-select
      onClick={(e) => e.stopPropagation()}
    >
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
          readOnly={disabled}
          className={inputClass}
          aria-label="Clip mark-in time"
          placeholder={timePlaceholder}
          title={disabled ? "Locked while clip is encoding" : timeTitle}
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
          readOnly={disabled}
          className={inputClass}
          aria-label="Clip mark-out time"
          placeholder={timePlaceholder}
          title={disabled ? "Locked while clip is encoding" : timeTitle}
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
  vodJobs: VodJobRecord[];
  clipVodEncodeErrors: Record<string, string>;
  onClipStartVodEncode: (clipId: string, includeAds: boolean) => void | Promise<void>;
  onClipCancelVodEncode: (clipId: string) => void | Promise<void>;
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
  vodJobs,
  clipVodEncodeErrors,
  onClipStartVodEncode,
  onClipCancelVodEncode,
}: EditorClipsListProps) {
  const thumbHeight = compact ? THUMB_HEIGHT_COMPACT : THUMB_HEIGHT_DEFAULT;
  const thumbWidth = Math.round(thumbHeight * (16 / 9));

  const [titleEditId, setTitleEditId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [encodedOutputPreview, setEncodedOutputPreview] = useState<{
    url: string;
    label: string;
  } | null>(null);

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

  useEffect(() => {
    if (!titleEditId) return;
    const j = pickLatestJobForEditorClip(vodJobs, titleEditId);
    if (j && vodJobIsActive(j.status)) {
      setTitleEditId(null);
    }
  }, [vodJobs, titleEditId]);

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
    <>
      {encodedOutputPreview ? (
        <ModalOverlay
          isOpen
          onOpenChange={(open) => {
            if (!open) setEncodedOutputPreview(null);
          }}
          isDismissable
          isKeyboardDismissDisabled={false}
          className="z-[85]"
        >
          <Modal className="z-[86]">
            <Dialog
              aria-label="Encoded clip playback"
              className="mx-4 flex w-full max-w-4xl justify-center outline-hidden sm:mx-auto"
            >
              <div className="relative w-full rounded-xl border border-secondary bg-primary p-4 shadow-xl">
                <CloseButton
                  slot="close"
                  size="xs"
                  label="Close"
                  className="absolute top-3 right-3 z-10"
                />
                <h3 className="pr-10 text-sm font-semibold text-primary">
                  {encodedOutputPreview.label}
                </h3>
                <p className="mt-0.5 text-xs text-tertiary">Encoded output preview</p>
                <video
                  key={encodedOutputPreview.url}
                  className="mt-3 aspect-video w-full rounded-lg bg-black"
                  src={encodedOutputPreview.url}
                  controls
                  playsInline
                />
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}

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
          const vodJob = pickLatestJobForEditorClip(vodJobs, c.id);
          const encodeActive = !!(vodJob && vodJobIsActive(vodJob.status));
          const encodeFailed = vodJob?.status === "failed";
          const rowEncodeError =
            clipVodEncodeErrors[c.id] ?? (encodeFailed ? vodJob?.error ?? "Encode failed" : undefined);
          const encodedOutputUrl = pickLatestCompletedOutputUrlForEditorClip(vodJobs, c.id);
          const encodedPreviewLabel = c.title?.trim() || `Clip ${c.order}`;
          return (
            <li
              key={c.id}
              data-editor-subclip-focus
              tabIndex={encodeActive ? -1 : 0}
              onClick={(e) => {
                if (encodeActive) return;
                if ((e.target as HTMLElement).closest("[data-no-row-select]")) return;
                handleRowClick();
              }}
              onKeyDown={(e) => {
                if (encodeActive) return;
                if ((e.target as HTMLElement).closest("[data-no-row-select]")) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleRowClick();
                }
              }}
              className={cx(
                "box-border flex flex-col gap-1.5 rounded-lg px-1.5 py-1.5 transition-colors outline-none sm:px-2",
                encodeActive
                  ? "cursor-default border-2 border-solid border-violet-500 bg-secondary focus-visible:ring-2 focus-visible:ring-violet-500/40"
                  : encodeFailed
                    ? "cursor-pointer border-2 border-solid border-error-primary bg-secondary focus-visible:ring-2 focus-visible:ring-error-primary/30"
                    : isSelected
                      ? "cursor-pointer border border-solid border-brand-solid bg-brand-solid/10 focus-visible:ring-2 focus-visible:ring-brand-secondary/40"
                      : "cursor-pointer border border-solid border-secondary bg-secondary hover:bg-tertiary/50 focus-visible:ring-2 focus-visible:ring-brand-secondary/40",
              )}
            >
              <div
                className={cx(
                  "flex flex-wrap items-start gap-2 sm:flex-nowrap",
                  encodeActive && "pointer-events-none select-none",
                )}
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
                disabled={encodeActive}
              />
              <button
                type="button"
                disabled={encodeActive}
                onClick={(e) => {
                  e.stopPropagation();
                  if (encodeActive) return;
                  if (isThisPlaying) onPause();
                  else onPlaySubclip(c);
                }}
                title={encodeActive ? "Locked while encoding" : undefined}
                className={cx(
                  "flex shrink-0 items-center justify-center rounded-lg border border-secondary bg-primary text-fg-secondary transition-colors",
                  encodeActive
                    ? "cursor-not-allowed opacity-45"
                    : "hover:bg-secondary",
                  compact ? "size-7" : "size-8",
                )}
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
                {titleEditId === c.id && !encodeActive ? (
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
                ) : encodeActive ? (
                  <div
                    className={cx(
                      "w-full min-w-0 cursor-default truncate rounded border border-secondary bg-secondary px-2 py-2 text-left font-semibold text-secondary",
                      c.title?.trim() ? "text-primary" : "text-tertiary italic",
                      compact ? "text-[10px]" : "text-xs",
                    )}
                    title="Title cannot be edited while this clip is encoding. Use Stop to cancel."
                  >
                    {c.title?.trim() || "Add title"}
                  </div>
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
                <div className="flex w-full min-w-0 shrink-0 flex-row flex-wrap items-center gap-1.5">
                  {encodedOutputUrl ? (
                    <span
                      className={encodeActive ? "pointer-events-auto inline-flex shrink-0" : "inline-flex shrink-0"}
                      data-no-row-select
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setEncodedOutputPreview({
                            url: encodedOutputUrl,
                            label: encodedPreviewLabel,
                          })
                        }
                        title="Play encoded output"
                        aria-label="Play encoded output in a dialog"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-utility-success-300 bg-utility-success-100 text-utility-success-800 shadow-sm transition-colors hover:bg-utility-success-200 hover:border-utility-success-400"
                      >
                        <Play className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  ) : null}
                  <div className="flex min-w-0 flex-row flex-wrap items-center gap-1.5">
                    {onEditMetadata ? (
                      <button
                        type="button"
                        disabled={encodeActive}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (encodeActive) return;
                          onEditMetadata(c);
                        }}
                        title={
                          encodeActive
                            ? "Metadata locked while encoding. Use Stop to cancel."
                            : "Edit clip metadata"
                        }
                        className={cx(
                          "flex size-8 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary transition-colors hover:bg-secondary hover:text-fg-secondary",
                          encodeActive && "cursor-not-allowed opacity-45 hover:bg-primary",
                        )}
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
                          disabled={encodeActive}
                          onToggle={() => onToggleClipSubtitle(c.id)}
                        />
                      </span>
                    ) : null}
                    {onToggleClipVerticalCrop ? (
                      <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                        <EditorVerticalCropButton
                          variant="inline"
                          active={!!c.verticalCropMode}
                          disabled={encodeActive}
                          onToggle={() => onToggleClipVerticalCrop(c.id)}
                        />
                      </span>
                    ) : null}
                    {onCaptureClipPoster ? (
                      <span className="relative inline-flex shrink-0" data-no-row-select onClick={(e) => e.stopPropagation()}>
                        <MenuTrigger isDisabled={encodeActive}>
                          <AriaButton
                            aria-label="Poster capture at playhead"
                            isDisabled={encodeActive}
                            className={({ isPressed, isFocusVisible }) =>
                              cx(
                                "relative flex size-8 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary transition-colors",
                                encodeActive
                                  ? "cursor-not-allowed opacity-45"
                                  : "cursor-pointer hover:bg-secondary hover:text-fg-secondary",
                                (isPressed || isFocusVisible) && !encodeActive && "outline-2 outline-offset-2 outline-focus-ring",
                              )
                            }
                          >
                            <Camera01 className="size-3.5" aria-hidden />
                            {posterCount > 0 ? (
                              <span className="pointer-events-none absolute -top-1 -right-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-brand-solid px-0.5 text-[9px] font-bold leading-none text-white ring-2 ring-primary">
                                {posterCount > 99 ? "99+" : posterCount}
                              </span>
                            ) : null}
                          </AriaButton>
                          <AriaPopover
                            placement="bottom start"
                            offset={6}
                            className={({ isEntering, isExiting }) =>
                              cx(
                                "will-change-transform",
                                isEntering &&
                                  "duration-200 ease-out animate-in fade-in placement-bottom:slide-in-from-top-2 placement-top:slide-in-from-bottom-2",
                                isExiting &&
                                  "duration-150 ease-in animate-out fade-out placement-bottom:slide-out-to-top-2 placement-top:slide-out-to-bottom-2",
                              )
                            }
                          >
                            <Menu
                              className="min-w-56 rounded-lg border border-secondary_alt bg-primary p-1 shadow-lg outline-none"
                              onAction={(key) => {
                                if (key === "poster-capture") onCaptureClipPoster(c.id);
                              }}
                            >
                              <MenuItem
                                id="poster-capture"
                                isDisabled={encodeActive}
                                className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                              >
                                Capture poster at playhead
                              </MenuItem>
                            </Menu>
                          </AriaPopover>
                        </MenuTrigger>
                      </span>
                    ) : null}
                  </div>
                  <div className="ml-auto flex shrink-0 flex-row items-center gap-1.5" data-no-row-select onClick={(e) => e.stopPropagation()}>
                    <MenuTrigger isDisabled={encodeActive}>
                      <AriaButton
                        aria-label="Encode clip: create with or without ads"
                        isDisabled={encodeActive}
                        className={({ isPressed, isFocusVisible }) =>
                          cx(
                            "flex size-8 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary transition-colors",
                            encodeActive
                              ? "cursor-not-allowed opacity-45"
                              : "cursor-pointer hover:bg-secondary hover:text-fg-secondary",
                            (isPressed || isFocusVisible) && !encodeActive && "outline-2 outline-offset-2 outline-focus-ring",
                          )
                        }
                      >
                        <Clapperboard className="size-3.5" aria-hidden />
                      </AriaButton>
                      <AriaPopover
                        placement="bottom end"
                        offset={6}
                        className={({ isEntering, isExiting }) =>
                          cx(
                            "will-change-transform",
                            isEntering &&
                              "duration-200 ease-out animate-in fade-in placement-bottom:slide-in-from-top-2 placement-top:slide-in-from-bottom-2",
                            isExiting &&
                              "duration-150 ease-in animate-out fade-out placement-bottom:slide-out-to-top-2 placement-top:slide-out-to-bottom-2",
                          )
                        }
                      >
                        <Menu
                          className="min-w-56 rounded-lg border border-secondary_alt bg-primary p-1 shadow-lg outline-none"
                          onAction={(key) => {
                            if (key === "create-no-ads") void onClipStartVodEncode(c.id, false);
                            if (key === "create-with-ads") void onClipStartVodEncode(c.id, true);
                          }}
                        >
                          <MenuItem
                            id="create-no-ads"
                            isDisabled={encodeActive}
                            className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                          >
                            Create without ads
                          </MenuItem>
                          <MenuItem
                            id="create-with-ads"
                            isDisabled={encodeActive}
                            className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                          >
                            Create with ads
                          </MenuItem>
                        </Menu>
                      </AriaPopover>
                    </MenuTrigger>
                    <button
                      type="button"
                      disabled={encodeActive}
                      title={encodeActive ? "Locked while encoding" : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (encodeActive) return;
                        handleRemove(c.id);
                      }}
                      className={cx(
                        "flex size-8 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary text-error-primary transition-colors",
                        encodeActive
                          ? "cursor-not-allowed opacity-45"
                          : "hover:bg-error-secondary hover:text-error-primary",
                      )}
                      aria-label="Remove sub-clip"
                    >
                      <Trash01 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              </div>
              {encodeActive || rowEncodeError ? (
                <div
                  className="w-full shrink-0 px-0.5 pb-0.5"
                  data-no-row-select
                  onClick={(e) => e.stopPropagation()}
                >
                  {encodeActive ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-quaternary">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 transition-[width] duration-300 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, vodJob?.progress ?? 0))}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-[10px] font-medium tabular-nums text-secondary">
                          {vodJob?.progress ?? 0}%
                        </span>
                        {vodJob && vodJobCanCancel(vodJob.status) ? (
                          <button
                            type="button"
                            onClick={() => void onClipCancelVodEncode(c.id)}
                            className="shrink-0 rounded-md border border-error_subtle bg-error-secondary px-2 py-0.5 text-[10px] font-semibold text-error-primary transition-colors hover:bg-error-primary hover:text-white"
                          >
                            Stop
                          </button>
                        ) : null}
                      </div>
                      {vodJob?.message ? (
                        <p className="truncate text-[10px] text-tertiary">
                          {vodJob.phase}: {vodJob.message}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {rowEncodeError ? (
                    <p className={cx("text-[10px] text-error-primary", encodeActive && "mt-0.5")}>
                      {rowEncodeError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
    </>
  );
}
