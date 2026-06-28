import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Brush01,
  Camera01,
  Clapperboard,
  Clipboard,
  Edit01,
  Play,
  Share01,
  StopCircle,
  Trash01,
} from "@untitledui/icons";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { Tabs } from "@/components/application/tabs/tabs";
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
import {
  pickLatestRealtimeTranscribeJobForEditorClip,
  pickLatestVodEncodeJobForEditorClip,
} from "@/types/vod-job";
import { patchVodJobNewsBundle, patchVodJobTranscriptSpeakers } from "@/services/vod.service";
import type { TranscriptNewsBundle, TranscriptNewsLocaleBlock } from "@/types/vod-job";
import { deriveTranscriptNewsBundleFromJob } from "@/utils/transcript-news-bundle";
import {
  collectUniqueSpeakerIds,
  defaultSpeakerDisplayName,
  rebuildTranscriptPreviewText,
} from "@/utils/transcript-diarization";
import { cx } from "@/utils/cx";
import { buildMarkOutThumbnailUrl, buildThumbnailUrl, FRAME_DURATION_SEC } from "./editor-constants";
import { TranscriptNewsLocalePanel } from "./transcript-news-locale-panel";
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

function vodJobHasDiarizedTranscript(job: VodJobRecord): boolean {
  const di = job.transcriptDiarization;
  return Boolean(di && Array.isArray(di.segments) && di.segments.length > 0);
}

function vodJobHadSubtitlesOrNewsRequested(job: VodJobRecord): boolean {
  if (job.jobKind === "realtime_transcribe") return false;
  const spec = job.editorSpec;
  if (!spec || typeof spec !== "object") return false;
  if (spec.transcribeGenerateNews === true) return true;
  const clips = Array.isArray(spec.clips) ? spec.clips : [];
  for (const c of clips) {
    if (!c || typeof c !== "object") continue;
    if (c.subtitleMode === true) return true;
    const subs = c.subtitles;
    if (subs && typeof subs === "object" && subs.enabled === true) return true;
  }
  const rootSubs = spec.subtitles;
  if (rootSubs && typeof rootSubs === "object" && rootSubs.enabled === true) return true;
  return false;
}

function vodJobHasNewsPayload(job: VodJobRecord): boolean {
  return Boolean(
    job.transcriptNewsEn?.trim() ||
      job.transcriptNewsEs?.trim() ||
      job.transcriptNewsHe?.trim() ||
      (job.transcriptNewsBundle && typeof job.transcriptNewsBundle === "object"),
  );
}

/** VOD encode row: show transcript control while job runs or when it finished with STT payload. */
function vodEncodeJobSupportsTranscriptModal(
  job: VodJobRecord | undefined,
  transcriptNewsUiEnabled: boolean,
): boolean {
  if (!job || job.jobKind === "realtime_transcribe") return false;
  if (vodJobIsActive(job.status)) return true;
  if (job.status === "failed") return true;
  if (job.status === "completed") {
    if (Boolean(job.transcriptText?.trim()) || vodJobHasDiarizedTranscript(job)) return true;
    if (vodJobHasNewsPayload(job)) return true;
    if (transcriptNewsUiEnabled && vodJobHadSubtitlesOrNewsRequested(job)) return true;
  }
  return false;
}

function emptyNewsBlock(): TranscriptNewsLocaleBlock {
  const d = new Date();
  return {
    title: "News",
    description: "",
    posterCaption: "",
    date: d.toISOString().slice(0, 10),
    time: d.toTimeString().slice(0, 5),
    posterUrl: null,
    posterDataUrl: null,
    htmlBody: "<p></p>",
  };
}

function TranscriptAndNewsTabs({
  job,
  onVodJobsRefresh,
  clipUrl,
  channelId,
  clipStartTime,
}: {
  job: VodJobRecord;
  onVodJobsRefresh?: () => Promise<void>;
  clipUrl: string;
  channelId: string;
  clipStartTime: number;
}) {
  const di = job.transcriptDiarization;
  const hasDi = vodJobHasDiarizedTranscript(job);
  const speakerIds = useMemo(() => (hasDi && di ? collectUniqueSpeakerIds(di) : []), [hasDi, di]);

  const [localLabels, setLocalLabels] = useState<Record<string, string>>({});
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const defaultPosterUrl = useMemo(
    () => buildThumbnailUrl(clipUrl, clipStartTime, channelId),
    [clipUrl, clipStartTime, channelId],
  );

  const [bundle, setBundle] = useState<TranscriptNewsBundle>(() =>
    deriveTranscriptNewsBundleFromJob(job, { defaultPosterUrl }),
  );
  const [newsSaveErr, setNewsSaveErr] = useState<string | null>(null);
  const [newsSaving, setNewsSaving] = useState(false);

  useEffect(() => {
    const base = job.transcriptDiarization?.speakerLabels;
    setLocalLabels(base && typeof base === "object" ? { ...base } : {});
    setSaveErr(null);
  }, [job.id, job.updatedAt, job.transcriptDiarization?.speakerLabels]);

  const mergedDiForPreview = useMemo(() => {
    if (!hasDi || !di) return null;
    return {
      ...di,
      speakerLabels: { ...(di.speakerLabels ?? {}), ...localLabels },
    };
  }, [hasDi, di, localLabels]);

  const raw = useMemo(() => {
    if (mergedDiForPreview) return rebuildTranscriptPreviewText(mergedDiForPreview);
    return job.transcriptText?.trim() ?? "";
  }, [mergedDiForPreview, job.transcriptText]);

  const newsEn = job.transcriptNewsEn?.trim() ?? "";
  const newsEs = job.transcriptNewsEs?.trim() ?? "";
  const newsHe = job.transcriptNewsHe?.trim() ?? "";
  const newsErr = job.transcriptNewsError?.trim();

  const hasAnyNews = Boolean(newsEn || newsEs || newsHe);

  const handleSaveSpeakers = useCallback(async () => {
    if (!hasDi || !di || speakerIds.length === 0) return;
    setSaveErr(null);
    setSaving(true);
    try {
      const transcriptSpeakerLabels: Record<string, string> = {};
      for (const id of speakerIds) {
        transcriptSpeakerLabels[id] = (localLabels[id] ?? "").trim();
      }
      await patchVodJobTranscriptSpeakers(job.id, transcriptSpeakerLabels);
      await onVodJobsRefresh?.();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Failed to save speaker names");
    } finally {
      setSaving(false);
    }
  }, [hasDi, di, speakerIds, localLabels, job.id, onVodJobsRefresh]);

  const handleSaveNews = useCallback(async () => {
    setNewsSaveErr(null);
    setNewsSaving(true);
    try {
      await patchVodJobNewsBundle(job.id, bundle);
      await onVodJobsRefresh?.();
    } catch (e) {
      setNewsSaveErr(e instanceof Error ? e.message : "Failed to save news");
    } finally {
      setNewsSaving(false);
    }
  }, [job.id, bundle, onVodJobsRefresh]);

  const enBlock = bundle.en ?? emptyNewsBlock();
  const esBlock = bundle.es ?? emptyNewsBlock();
  const heBlock = bundle.he ?? emptyNewsBlock();

  return (
    <div className="min-w-0">
      {newsErr ? (
        <p className="mb-2 rounded-md border border-error_subtle bg-error-primary/5 px-2 py-1.5 text-xs text-error-primary">
          {newsErr}
        </p>
      ) : null}
      {!hasAnyNews && !newsErr ? (
        <p className="mb-2 text-xs text-tertiary">
          No AI news drafts: enable <strong>News tabs</strong> in transcribe settings and configure{" "}
          <span className="rounded bg-secondary px-1 font-mono text-[11px]">OPENAI_API_KEY</span> on the encoder, or
          edit cards below manually and save.
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-secondary">News cards</p>
        <button
          type="button"
          data-no-row-select
          disabled={newsSaving}
          onClick={() => void handleSaveNews()}
          className="rounded-lg border border-secondary bg-secondary px-3 py-1.5 text-xs font-medium text-primary hover:bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {newsSaving ? "Saving…" : "Save news cards"}
        </button>
      </div>
      {newsSaveErr ? (
        <p className="mb-2 text-xs text-error-primary">{newsSaveErr}</p>
      ) : null}
      {hasDi && speakerIds.length > 0 ? (
        <div className="mb-3 rounded-lg border border-secondary bg-secondary/40 px-3 py-2.5">
          <p className="text-xs font-medium text-secondary">Speakers</p>
          <p className="mt-0.5 text-[11px] text-tertiary">
            Override display names for each system speaker id. Empty uses the default label (e.g. Speaker A).
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {speakerIds.map((id) => (
              <li key={id} className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                <span className="shrink-0 font-mono text-[11px] text-tertiary" title="Diarization id">
                  {id}
                </span>
                <input
                  type="text"
                  data-no-row-select
                  className="min-w-0 flex-1 rounded border border-secondary bg-primary px-2 py-1 text-sm text-primary outline-none placeholder:text-placeholder"
                  placeholder={defaultSpeakerDisplayName(id)}
                  value={localLabels[id] ?? ""}
                  onChange={(e) =>
                    setLocalLabels((prev) => ({
                      ...prev,
                      [id]: e.target.value,
                    }))
                  }
                  aria-label={`Display name for speaker ${id}`}
                />
              </li>
            ))}
          </ul>
          {saveErr ? <p className="mt-2 text-xs text-error-primary">{saveErr}</p> : null}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              data-no-row-select
              disabled={saving}
              onClick={() => void handleSaveSpeakers()}
              className="rounded-lg border border-secondary bg-secondary px-3 py-1.5 text-xs font-medium text-primary hover:bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save speaker names"}
            </button>
          </div>
        </div>
      ) : null}
      <Tabs defaultSelectedKey="raw" className="min-w-0 gap-3">
        <Tabs.List
          type="underline"
          orientation="horizontal"
          fullWidth
          items={[
            { id: "raw", label: "Transcript", children: "Transcript" },
            { id: "en", label: "English", children: "English" },
            { id: "es", label: "Español", children: "Español" },
            { id: "he", label: "עברית", children: "עברית" },
          ]}
        />
        <Tabs.Panel id="raw" className="min-h-[100px] pt-1">
          {raw ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-primary">{raw}</pre>
          ) : (
            <p className="text-tertiary">No transcript text.</p>
          )}
          {hasDi ? (
            <p className="mt-2 text-[11px] text-tertiary">
              Transcript lines follow diarized turns. Unsaved name edits are reflected in this preview only until you
              save.
            </p>
          ) : null}
        </Tabs.Panel>
        <Tabs.Panel id="en" className="min-h-[120px] max-h-[55vh] overflow-y-auto pt-1" lang="en">
          <TranscriptNewsLocalePanel
            locale="en"
            jobId={job.id}
            jobContentStamp={job.updatedAt ?? job.createdAt}
            block={enBlock}
            onChange={(next) => setBundle((b) => ({ ...b, version: 1, en: next }))}
            defaultPosterUrl={defaultPosterUrl}
          />
        </Tabs.Panel>
        <Tabs.Panel id="es" className="min-h-[120px] max-h-[55vh] overflow-y-auto pt-1" lang="es">
          <TranscriptNewsLocalePanel
            locale="es"
            jobId={job.id}
            jobContentStamp={job.updatedAt ?? job.createdAt}
            block={esBlock}
            onChange={(next) => setBundle((b) => ({ ...b, version: 1, es: next }))}
            defaultPosterUrl={defaultPosterUrl}
          />
        </Tabs.Panel>
        <Tabs.Panel id="he" className="min-h-[120px] max-h-[55vh] overflow-y-auto pt-1" dir="rtl" lang="he">
          <TranscriptNewsLocalePanel
            locale="he"
            jobId={job.id}
            jobContentStamp={job.updatedAt ?? job.createdAt}
            block={heBlock}
            onChange={(next) => setBundle((b) => ({ ...b, version: 1, he: next }))}
            defaultPosterUrl={defaultPosterUrl}
          />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
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
  const completed = jobs.filter(
    (j) =>
      j.editorClipId === clipId &&
      j.status === "completed" &&
      j.jobKind !== "realtime_transcribe",
  );
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
    <div className={cx("flex shrink-0 gap-1", disabled && "opacity-60")}>
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
          readOnly={disabled}
          data-no-row-select
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
          readOnly={disabled}
          data-no-row-select
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
  /** When set, show Syndication control next to metadata (tenant must allow YouTube and/or X syndication). */
  onOpenSyndication?: (clip: EditorSubClip) => void;
  onSeek?: (timeSeconds: number) => void;
  /** When false, skip VOD thumbnail URLs (e.g. live / realtime session offsets). */
  thumbnailsEnabled?: boolean;
  emptyHint?: string;
  /** Narrow sidebar layout (smaller thumbs, tighter row). */
  compact?: boolean;
  /** Opens vertical crop modal and selects the clip (parent should focus timeline on this clip). */
  onOpenVerticalCropModal?: (clipId: string) => void;
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
  onAddTextWidget?: (clipId: string) => void;
  onAddImageWidgetFromFile?: (clipId: string, file: File) => Promise<void>;
  /** Realtime session: show transcript viewer control on each clip row. */
  realtimeTranscriptUi?: boolean;
  /** When true, completed VOD encodes with subtitles/news requested show transcript control. */
  vodTranscriptNewsUiEnabled?: boolean;
  vodJobs: VodJobRecord[];
  clipVodEncodeErrors: Record<string, string>;
  onClipStartVodEncode: (clipId: string, includeAds: boolean) => void | Promise<void>;
  onClipCancelVodEncode: (clipId: string) => void | Promise<void>;
  /** After PATCH transcript speakers; keeps job list in sync (optional). */
  onVodJobsRefresh?: () => Promise<void>;
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
  onOpenSyndication,
  onSeek,
  thumbnailsEnabled = true,
  emptyHint = "Use Mark In / Mark Out to add ranges.",
  compact = false,
  onOpenVerticalCropModal,
  onToggleClipSubtitle,
  parentWindowDurationSec,
  onClipTimesCommit,
  onUpdateClipTitle,
  onCaptureClipPoster,
  onAddTextWidget,
  onAddImageWidgetFromFile,
  realtimeTranscriptUi = false,
  vodTranscriptNewsUiEnabled = true,
  vodJobs,
  clipVodEncodeErrors,
  onClipStartVodEncode,
  onClipCancelVodEncode,
  onVodJobsRefresh,
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
  const [imageWidgetClipId, setImageWidgetClipId] = useState<string | null>(null);
  const [imageWidgetErr, setImageWidgetErr] = useState<string | null>(null);
  const [imageWidgetBusy, setImageWidgetBusy] = useState(false);
  const imageWidgetFileInputRef = useRef<HTMLInputElement>(null);
  const [transcriptModalClipId, setTranscriptModalClipId] = useState<string | null>(null);

  const transcriptModalClip = useMemo(
    () => (transcriptModalClipId ? clips.find((x) => x.id === transcriptModalClipId) ?? null : null),
    [clips, transcriptModalClipId],
  );
  const transcriptModalJob = useMemo(() => {
    if (!transcriptModalClipId) return null;
    if (realtimeTranscriptUi) {
      return pickLatestRealtimeTranscribeJobForEditorClip(vodJobs, transcriptModalClipId);
    }
    return pickLatestVodEncodeJobForEditorClip(vodJobs, transcriptModalClipId);
  }, [vodJobs, transcriptModalClipId, realtimeTranscriptUi]);

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
    if (transcriptModalClipId && !clips.some((c) => c.id === transcriptModalClipId)) {
      setTranscriptModalClipId(null);
    }
  }, [clips, transcriptModalClipId]);

  useEffect(() => {
    if (!titleEditId) return;
    const j = pickLatestVodEncodeJobForEditorClip(vodJobs, titleEditId);
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
        >
          <Modal>
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

      {imageWidgetClipId ? (
        <ModalOverlay
          isOpen
          onOpenChange={(open) => {
            if (!open && !imageWidgetBusy) {
              setImageWidgetClipId(null);
              setImageWidgetErr(null);
            }
          }}
          isDismissable={!imageWidgetBusy}
          isKeyboardDismissDisabled={imageWidgetBusy}
        >
          <Modal>
            <Dialog
              aria-label="Upload widget image"
              className="mx-4 flex w-full max-w-md justify-center outline-hidden sm:mx-auto"
            >
              <div className="relative w-full rounded-xl border border-secondary bg-primary p-4 shadow-xl">
                <CloseButton
                  slot="close"
                  size="xs"
                  label="Close"
                  className="absolute top-3 right-3 z-10"
                  isDisabled={imageWidgetBusy}
                />
                <h3 className="pr-10 text-sm font-semibold text-primary">Add image widget</h3>
                <p className="mt-1 text-xs text-tertiary">
                  PNG, JPEG, or animated GIF (including transparent GIFs). Stored for preview and VOD encode; move and
                  resize on the player.
                </p>
                <input
                  ref={imageWidgetFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f || !imageWidgetClipId) return;
                    void (async () => {
                      setImageWidgetBusy(true);
                      setImageWidgetErr(null);
                      try {
                        await onAddImageWidgetFromFile!(imageWidgetClipId, f);
                        setImageWidgetClipId(null);
                      } catch (err) {
                        setImageWidgetErr(err instanceof Error ? err.message : "Upload failed");
                      } finally {
                        setImageWidgetBusy(false);
                      }
                    })();
                  }}
                />
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={imageWidgetBusy || !channelId.trim()}
                    onClick={() => imageWidgetFileInputRef.current?.click()}
                    className="rounded-lg border border-secondary bg-secondary px-3 py-2 text-sm font-medium text-primary hover:bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {imageWidgetBusy ? "Uploading…" : "Choose image file"}
                  </button>
                  {!channelId.trim() ? (
                    <p className="text-xs text-error-primary">Channel ID is required for upload.</p>
                  ) : null}
                  {imageWidgetErr ? <p className="text-xs text-error-primary">{imageWidgetErr}</p> : null}
                </div>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}

      {transcriptModalClipId ? (
        <ModalOverlay
          isOpen
          onOpenChange={(open) => {
            if (!open) setTranscriptModalClipId(null);
          }}
          isDismissable
          isKeyboardDismissDisabled={false}
        >
          <Modal>
            <Dialog
              aria-label="Clip transcript"
              className="mx-4 flex w-full max-w-4xl justify-center outline-hidden sm:mx-auto"
            >
              <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
                <CloseButton
                  slot="close"
                  size="xs"
                  label="Close"
                  className="absolute top-3 right-3 z-10"
                />
                <h3 className="pr-10 text-sm font-semibold text-primary">
                  Transcript & news
                  {transcriptModalClip ? (
                    <span className="block text-xs font-normal text-tertiary">
                      {transcriptModalClip.title?.trim() || `Clip ${transcriptModalClip.order}`}
                    </span>
                  ) : null}
                </h3>
                <div className="mt-3 text-sm text-primary">
                  {!transcriptModalJob ? (
                    <p className="text-tertiary">
                      {realtimeTranscriptUi
                        ? "No transcript job for this clip yet. Enable Transcribe on the REC bar and finish a segment."
                        : "No encode job for this clip yet. Encode the clip to generate a transcript (OpenAI STT after encoding)."}
                    </p>
                  ) : transcriptModalJob.status === "failed" ? (
                    <p className="text-error-primary">{transcriptModalJob.error ?? "Transcript failed"}</p>
                  ) : vodJobIsActive(transcriptModalJob.status) ? (
                    <div className="space-y-2">
                      <p className="text-tertiary">
                        {transcriptModalJob.message ?? transcriptModalJob.phase ?? "Processing…"}
                      </p>
                      {transcriptModalJob.phase === "generating_news" ? (
                        <p className="text-xs text-tertiary">
                          Drafting broadcast-style news in English, Spanish, and Hebrew (OpenAI)…
                        </p>
                      ) : null}
                    </div>
                  ) : transcriptModalJob.transcriptText?.trim() || vodJobHasDiarizedTranscript(transcriptModalJob) ? (
                    <TranscriptAndNewsTabs
                      key={`${transcriptModalJob.id}-${transcriptModalJob.updatedAt ?? transcriptModalJob.createdAt}`}
                      job={transcriptModalJob}
                      onVodJobsRefresh={onVodJobsRefresh}
                      clipUrl={clipUrl}
                      channelId={channelId}
                      clipStartTime={transcriptModalClip?.startTime ?? 0}
                    />
                  ) : (
                    <p className="text-tertiary">No text returned.</p>
                  )}
                </div>
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
          const thumbOutUrl = buildMarkOutThumbnailUrl(clipUrl, c.startTime, c.endTime, channelId);
          const tw = thumbWidth;
          const th = thumbHeight;
          const posterCount = c.posters?.length ?? 0;
          const vodJob = pickLatestVodEncodeJobForEditorClip(vodJobs, c.id);
          const transcribeJob = pickLatestRealtimeTranscribeJobForEditorClip(vodJobs, c.id);
          const encodeActive = !!(vodJob && vodJobIsActive(vodJob.status));
          const encodeFailed = vodJob?.status === "failed";
          const rowEncodeError =
            clipVodEncodeErrors[c.id] ?? (encodeFailed ? vodJob?.error ?? "Encode failed" : undefined);
          const encodedOutputUrl = pickLatestCompletedOutputUrlForEditorClip(vodJobs, c.id);
          const encodedPreviewLabel = c.title?.trim() || `Clip ${c.order}`;
          const syndicationCount = [
            c.syndication?.youtube?.enabled === true,
            c.syndication?.twitter?.enabled === true,
            c.syndication?.facebook?.enabled === true,
            c.syndication?.instagram?.enabled === true,
            c.syndication?.tiktok?.enabled === true,
          ].filter(Boolean).length;
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
                  ? "animate-editor-encode-border motion-reduce:animate-none motion-reduce:shadow-none cursor-default border-2 border-solid border-violet-500 bg-secondary focus-visible:ring-2 focus-visible:ring-violet-500/40"
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
                    : "cursor-pointer hover:bg-secondary",
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
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div data-no-row-select>
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
                </div>
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
                        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-utility-success-300 bg-utility-success-100 text-utility-success-800 shadow-sm transition-colors hover:bg-utility-success-200 hover:border-utility-success-400"
                      >
                        <Play className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  ) : null}
                  {realtimeTranscriptUi || vodEncodeJobSupportsTranscriptModal(vodJob, vodTranscriptNewsUiEnabled) ? (
                    <span data-no-row-select onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0">
                      <button
                        type="button"
                        disabled={encodeActive}
                        onClick={() => setTranscriptModalClipId(c.id)}
                        title="View transcript"
                        aria-label="View transcript"
                        className={cx(
                          "flex size-8 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary transition-colors",
                          encodeActive && "cursor-not-allowed opacity-45 hover:bg-primary",
                          !encodeActive && "cursor-pointer hover:bg-secondary hover:text-fg-secondary",
                          ((realtimeTranscriptUi &&
                            transcribeJob &&
                            vodJobIsActive(transcribeJob.status)) ||
                            (!realtimeTranscriptUi &&
                              vodJob &&
                              vodJobIsActive(vodJob.status) &&
                              (vodJob.phase === "transcribing" || vodJob.phase === "generating_news"))) &&
                            "border-amber-500/80 text-amber-700 dark:text-amber-400",
                        )}
                      >
                        <Clipboard className="size-3.5" aria-hidden />
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
                          encodeActive
                            ? "cursor-not-allowed opacity-45 hover:bg-primary"
                            : "cursor-pointer",
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
                    {onOpenVerticalCropModal ? (
                      <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                        <EditorVerticalCropButton
                          variant="inline"
                          active={!!c.verticalCropMode}
                          disabled={encodeActive}
                          onOpen={() => onOpenVerticalCropModal(c.id)}
                        />
                      </span>
                    ) : null}
                    {onCaptureClipPoster ? (
                      <span className="relative inline-flex shrink-0" data-no-row-select onClick={(e) => e.stopPropagation()}>
                        <MenuTrigger>
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
                    {onAddTextWidget && onAddImageWidgetFromFile ? (
                      <span
                        className="relative inline-flex shrink-0"
                        data-no-row-select
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MenuTrigger>
                          <AriaButton
                            aria-label="Widgets"
                            isDisabled={encodeActive}
                            className={({ isPressed, isFocusVisible }) =>
                              cx(
                                "relative flex size-8 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary transition-colors",
                                encodeActive
                                  ? "cursor-not-allowed opacity-45"
                                  : "cursor-pointer hover:bg-secondary hover:text-fg-secondary",
                                (isPressed || isFocusVisible) &&
                                  !encodeActive &&
                                  "outline-2 outline-offset-2 outline-focus-ring",
                              )
                            }
                          >
                            <Brush01 className="size-3.5" aria-hidden />
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
                                if (key === "add-text") onAddTextWidget(c.id);
                                if (key === "add-image") {
                                  setImageWidgetErr(null);
                                  setImageWidgetClipId(c.id);
                                }
                              }}
                            >
                              <MenuItem
                                id="add-text"
                                isDisabled={encodeActive}
                                className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                              >
                                Add Text
                              </MenuItem>
                              <MenuItem
                                id="add-image"
                                isDisabled={encodeActive || !channelId.trim()}
                                className="cursor-pointer rounded-md px-3 py-2 text-left text-sm text-primary outline-none data-[focused]:bg-secondary"
                              >
                                Add Image
                              </MenuItem>
                            </Menu>
                          </AriaPopover>
                        </MenuTrigger>
                      </span>
                    ) : null}
                  </div>
                  <div className="ml-auto flex shrink-0 flex-row items-center gap-1.5" data-no-row-select onClick={(e) => e.stopPropagation()}>
                    <MenuTrigger>
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
                    {onOpenSyndication ? (
                      <button
                        type="button"
                        disabled={encodeActive}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (encodeActive) return;
                          onOpenSyndication(c);
                        }}
                        title={
                          encodeActive
                            ? "Syndication locked while encoding. Use Stop to cancel."
                            : "Syndication"
                        }
                        className={cx(
                          "relative flex size-8 shrink-0 items-center justify-center rounded-full border border-secondary bg-primary text-fg-quaternary transition-colors hover:bg-secondary hover:text-fg-secondary",
                          encodeActive
                            ? "cursor-not-allowed opacity-45 hover:bg-primary"
                            : "cursor-pointer",
                        )}
                        aria-label="Syndication"
                      >
                        <Share01 className="size-3.5" />
                        <span
                          className={cx(
                            "pointer-events-none absolute -top-1 -right-1 flex min-h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none ring-2 ring-primary",
                            syndicationCount > 0 ? "bg-brand-solid text-white" : "bg-secondary text-tertiary",
                          )}
                        >
                          {syndicationCount}
                        </span>
                      </button>
                    ) : null}
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
                          : "cursor-pointer hover:bg-error-secondary hover:text-error-primary",
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
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-quaternary">
                        <div
                          className="animate-editor-encode-progress-fill motion-reduce:animate-none h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-400 to-cyan-400 transition-[width] duration-300 ease-out"
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
