import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Clock, PlayCircle, Scissors01, Tv01 } from "@untitledui/icons";
import type { DateValue } from "react-aria-components";
import { ClipJsonButton } from "@/components/live2vod/clip-json-button";
import { ProcessingClipsNavButton } from "@/components/live2vod/processing-clips-nav-button";
import { ChannelTimelineSettings } from "@/components/live2vod/channel-timeline-settings";
import { useDateFormatter } from "react-aria";
import type { RangeValue } from "react-aria-components";
import { ChannelDatePicker } from "@/components/live2vod/channel-date-picker";
import { ChannelSingleDatePicker } from "@/components/live2vod/channel-single-date-picker";
import { ChannelList } from "@/components/live2vod/channel-list";
import type { TimeWindow } from "@/components/live2vod/timeline/timeline-panel";
import { TimelinePanel } from "@/components/live2vod/timeline/timeline-panel";
import { VideoPreview } from "@/components/live2vod/video-preview";
import { SexagesimalTimeInput } from "@/components/live2vod/sexagesimal-time-input";
import { RadioGroup, RadioButton } from "@/components/base/radio-buttons/radio-buttons";
import { useChannelDateRange } from "@/hooks/use-channel-date-range";
import { useChannels } from "@/hooks/use-channels";
import { useDebugToolbarVisible } from "@/hooks/use-debug-toolbar-visible";
import { useTimezone } from "@/hooks/use-timezone";
import type { Channel } from "@/types/channel";
import type { EditorClipState, EditorSelectionMode } from "@/types/editor";

type Live2VodWindowMode = "epg" | "timePicker" | "realtime";

function pickerDigitsToHHMM(d: string): string | null {
  if (!/^\d{4}$/.test(d)) return null;
  const hh = parseInt(d.slice(0, 2), 10);
  const mm = parseInt(d.slice(2, 4), 10);
  if (hh > 23 || mm > 59) return null;
  return `${d.slice(0, 2)}:${d.slice(2, 4)}`;
}

function parseSexagesimalTime(value: string): { hour: number; minute: number } | null {
  const m = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function timeWindowInsideArchive(
  startUnix: number,
  endUnix: number,
  archiveStart: Date,
  archiveEnd: Date,
): boolean {
  const a = archiveStart.getTime() / 1000;
  const b = archiveEnd.getTime() / 1000;
  return endUnix > startUnix && startUnix >= a && endUnix <= b;
}

/** Start-of-day instant in `tz` for calendar `date`, plus civil `hour`:`minute` (seconds granularity). */
function calendarDateTimeToUnix(date: DateValue, hour: number, minute: number, tz: string): number {
  const dayStartMs = date.toDate(tz).getTime();
  return Math.floor((dayStartMs + (hour * 3600 + minute * 60) * 1000) / 1000);
}

function buildClipUrl(baseUrl: string, tw: TimeWindow): string {
  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set("startTime", String(tw.startTime));
  url.searchParams.set("endTime", String(tw.endTime));
  return url.toString();
}

function selectionModeFor(mode: Live2VodWindowMode): EditorSelectionMode {
  if (mode === "timePicker") return "timePicker";
  if (mode === "realtime") return "realtime";
  return "epg";
}

export function Live2VodPage() {
  const tz = useTimezone();
  const debugToolbarVisible = useDebugToolbarVisible();
  const { channels, loading, error } = useChannels();
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [windowMode, setWindowMode] = useState<Live2VodWindowMode>("epg");
  const [dateRange, setDateRange] = useState<RangeValue<DateValue> | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow | null>(null);
  const [pickerDate, setPickerDate] = useState<DateValue | null>(null);
  const [pickerDigits, setPickerDigits] = useState("0000");
  const [pickerMinutes, setPickerMinutes] = useState(60);
  const { range: availableRange } = useChannelDateRange(selectedChannel, tz);

  const resetModeSpecificState = useCallback(() => {
    setDateRange(null);
    setTimeWindow(null);
    setPickerDate(null);
    setPickerDigits("0000");
    setPickerMinutes(60);
  }, []);

  const handleSelectChannel = (channel: Channel) => {
    setSelectedChannel(channel);
    setWindowMode("epg");
    resetModeSpecificState();
  };

  const handleWindowModeChange = (mode: Live2VodWindowMode) => {
    setWindowMode(mode);
    resetModeSpecificState();
  };

  const timePickerWindow = useMemo((): TimeWindow | null => {
    if (windowMode !== "timePicker" || !pickerDate || !availableRange) return null;
    const composed = pickerDigitsToHHMM(pickerDigits);
    if (!composed) return null;
    const parts = parseSexagesimalTime(composed);
    if (!parts) return null;
    const mins = Number(pickerMinutes);
    if (!Number.isFinite(mins) || mins <= 0 || mins > 24 * 60) return null;
    const startUnix = calendarDateTimeToUnix(pickerDate, parts.hour, parts.minute, tz);
    const endUnix = startUnix + Math.round(mins * 60);
    if (
      !timeWindowInsideArchive(startUnix, endUnix, availableRange.startDate, availableRange.endDate)
    ) {
      return null;
    }
    return { startTime: startUnix, endTime: endUnix };
  }, [windowMode, pickerDate, pickerDigits, pickerMinutes, availableRange, tz]);

  const navigate = useNavigate();

  const openEditor = (
    channel: Channel,
    tw: TimeWindow,
    clipUrl: string,
    mode: Live2VodWindowMode,
  ) => {
    const state: EditorClipState = {
      sourceM3u8: channel.hlsStream ?? "",
      startTime: tw.startTime,
      endTime: tw.endTime,
      clipUrl,
      channelId: channel.id,
      channelTitle: channel.title,
      selectionMode: selectionModeFor(mode),
    };
    navigate("/editor" + window.location.search, { state });
  };

  const jsonTimeWindow: TimeWindow | null =
    windowMode === "epg"
      ? timeWindow
      : windowMode === "timePicker"
        ? timePickerWindow
        : null;

  return (
    <div className="flex h-full flex-col bg-primary">
      <header className="flex items-center border-b border-secondary px-6 py-3">
        <h1 className="text-lg font-semibold text-primary">Live2VOD</h1>
      </header>

      <main className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r border-secondary">
          <div className="border-b border-secondary px-4 py-3">
            <h2 className="text-sm font-semibold text-primary">Channels</h2>
            <p className="mt-0.5 text-xs text-tertiary">
              Select a channel with live archive
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <ChannelList
              channels={channels}
              loading={loading}
              error={error}
              selectedChannel={selectedChannel}
              onSelectChannel={handleSelectChannel}
            />
          </div>
        </div>

        {selectedChannel ? (
          <>
            <div className="flex w-80 shrink-0 flex-col border-r border-secondary">
              <ChannelHeader channel={selectedChannel} />
              <div className="flex flex-1 flex-col overflow-y-auto p-3">
                {availableRange && (
                  <>
                    <div className="rounded-lg bg-secondary px-3 py-2">
                      <p className="text-xs text-tertiary">Available archive</p>
                      <ArchiveRangeLabel availableRange={availableRange} tz={tz} />
                    </div>

                    <RadioGroup
                      aria-label="Time window selection"
                      value={windowMode}
                      onChange={(v) => handleWindowModeChange(v as Live2VodWindowMode)}
                      className="mt-3 flex flex-col gap-4"
                      size="sm"
                    >
                      <div className="flex flex-col gap-2">
                        <RadioButton value="epg" label="Date and Time" />
                        {windowMode === "epg" && (
                          <div className="ml-6 flex flex-col gap-3 border-l border-secondary pl-3">
                            <ChannelDatePicker
                              availableRange={availableRange}
                              value={dateRange}
                              onChange={setDateRange}
                            />
                            {dateRange && <SelectedRangeInfo dateRange={dateRange} tz={tz} />}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <RadioButton value="timePicker" label="Time Picker" />
                        {windowMode === "timePicker" && (
                          <div className="ml-6 flex flex-col gap-3 border-l border-secondary pl-3">
                            <p className="text-xs text-tertiary">
                              Pick a date, start time (24h), and duration in minutes.
                            </p>
                            <ChannelSingleDatePicker
                              availableRange={availableRange}
                              value={pickerDate}
                              onChange={setPickerDate}
                            />
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-secondary" id="picker-start-time-label">
                                Start time (24h)
                              </span>
                              <SexagesimalTimeInput
                                id="picker-start-time"
                                aria-labelledby="picker-start-time-label"
                                value={pickerDigits}
                                onChange={setPickerDigits}
                                className="w-full max-w-[7.5rem] rounded-lg border border-secondary bg-primary px-2.5 py-2 font-mono text-sm text-primary tabular-nums outline-none focus:ring-2 focus:ring-brand-solid"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label htmlFor="picker-duration" className="text-xs font-medium text-secondary">
                                Duration (minutes)
                              </label>
                              <input
                                id="picker-duration"
                                type="number"
                                min={1}
                                max={1440}
                                value={pickerMinutes}
                                onChange={(e) => setPickerMinutes(Number(e.target.value))}
                                className="rounded-lg border border-secondary bg-primary px-2.5 py-2 text-sm text-primary"
                              />
                            </div>
                            {pickerDate &&
                              timePickerWindow === null &&
                              pickerDigitsToHHMM(pickerDigits) && (
                              <p className="text-xs text-error-primary">
                                Window must fall inside the available archive (max 24h duration check).
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <RadioButton value="realtime" label="Realtime" />
                        {windowMode === "realtime" && (
                          <div className="ml-6 space-y-1.5 border-l border-secondary pl-3 text-xs text-tertiary">
                            <p>
                              Opens the live editor. REC marks use{" "}
                              <strong className="font-medium text-secondary">wall-clock</strong> instants in{" "}
                              <span className="font-mono text-secondary">{tz}</span> (from the{" "}
                              <code className="rounded bg-secondary px-1 py-0.5 text-[10px]">?tz=</code> query or your
                              browser zone).
                            </p>
                            <p>
                              The exact reference is the Unix second when you press{" "}
                              <strong className="text-secondary">Next</strong>: every sub-clip is stored as seconds after that
                              moment; absolute in/out times are that instant plus the offset.
                            </p>
                          </div>
                        )}
                      </div>
                    </RadioGroup>
                  </>
                )}
              </div>
            </div>

            {windowMode === "epg" && (
              <div className="flex w-80 shrink-0 flex-col border-r border-secondary">
                {dateRange ? (
                  <TimelinePanel
                    dateRange={dateRange}
                    epgEvents={selectedChannel.epgEvents}
                    hlsStream={selectedChannel.hlsStream}
                    channelId={selectedChannel.id}
                    onTimeWindowChange={setTimeWindow}
                  />
                ) : (
                  <TimelinePlaceholder />
                )}
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
              {windowMode === "epg" && timeWindow && selectedChannel.hlsStream ? (
                <PreviewPanel
                  channel={selectedChannel}
                  streamUrl={selectedChannel.hlsStream}
                  timeWindow={timeWindow}
                  tz={tz}
                  selectionMode="epg"
                  onOpenEditor={openEditor}
                />
              ) : windowMode === "timePicker" && timePickerWindow && selectedChannel.hlsStream ? (
                <TimePickerPreviewPanel
                  channel={selectedChannel}
                  streamUrl={selectedChannel.hlsStream}
                  timeWindow={timePickerWindow}
                  tz={tz}
                  onOpenEditor={openEditor}
                />
              ) : windowMode === "realtime" && selectedChannel.hlsStream ? (
                <RealtimeNextPanel
                  streamUrl={selectedChannel.hlsStream}
                  channel={selectedChannel}
                  tz={tz}
                  onOpenEditor={openEditor}
                />
              ) : (
                <PreviewPlaceholder
                  windowMode={windowMode}
                  hasDateRange={!!dateRange}
                  hasPickerDate={!!pickerDate}
                  pickerValid={windowMode === "timePicker" && !!timePickerWindow}
                />
              )}
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </main>

      {debugToolbarVisible ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-row items-end gap-2">
          {selectedChannel?.id ? (
            <>
              <div className="pointer-events-auto">
                <ChannelTimelineSettings channelId={selectedChannel.id} />
              </div>
              <div className="pointer-events-auto">
                <ClipJsonButton
                  streamUrl={selectedChannel.hlsStream ?? null}
                  timeWindow={jsonTimeWindow}
                />
              </div>
            </>
          ) : null}
          <div className="pointer-events-auto">
            <ProcessingClipsNavButton />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ArchiveRangeLabel({
  availableRange,
  tz,
}: {
  availableRange: NonNullable<ReturnType<typeof useChannelDateRange>["range"]>;
  tz: string;
}) {
  const startLocal = availableRange.startDate.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
  const endLocal = availableRange.endDate.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
  return (
    <p className="mt-0.5 text-xs font-medium text-primary">
      {startLocal} — {endLocal}
    </p>
  );
}

function ChannelHeader({ channel }: { channel: Channel }) {
  return (
    <div className="flex items-center gap-2 border-b border-secondary px-4 py-3">
      <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
        {channel.posterUrl ? (
          <img
            src={channel.posterUrl}
            alt={channel.title}
            className="size-full object-cover"
          />
        ) : (
          <Tv01 className="size-3.5 text-fg-quaternary" />
        )}
      </div>
      <p className="truncate text-sm font-semibold text-primary">{channel.title}</p>
    </div>
  );
}

function SelectedRangeInfo({ dateRange, tz }: { dateRange: RangeValue<DateValue>; tz: string }) {
  const formatter = useDateFormatter({
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  });
  const from = formatter.format(dateRange.start.toDate(tz));
  const to = formatter.format(dateRange.end.toDate(tz));

  return (
    <div className="rounded-lg border border-brand bg-brand-primary px-3 py-2">
      <p className="text-xs text-tertiary">Selected range</p>
      <p className="mt-0.5 text-xs font-medium text-brand-secondary">
        {from} — {to}
      </p>
    </div>
  );
}

function TimelinePlaceholder() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <Clock className="mb-2 size-6 text-fg-quaternary" />
      <p className="text-sm font-medium text-primary">Timeline</p>
      <p className="mt-1 text-center text-sm text-tertiary">
        Select a date range to enable the timeline
      </p>
    </div>
  );
}

function PreviewPanel({
  channel,
  streamUrl,
  timeWindow,
  tz,
  selectionMode,
  onOpenEditor,
}: {
  channel: Channel;
  streamUrl: string;
  timeWindow: TimeWindow;
  tz: string;
  selectionMode: Live2VodWindowMode;
  onOpenEditor: (channel: Channel, tw: TimeWindow, clipUrl: string, mode: Live2VodWindowMode) => void;
}) {
  const fmt = (ts: number) =>
    new Date(ts * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });

  const durationSec = timeWindow.endTime - timeWindow.startTime;
  const hours = Math.floor(durationSec / 3600);
  const mins = Math.floor((durationSec % 3600) / 60);
  const durationLabel = hours > 0 ? `${hours}h ${mins > 0 ? `${mins}m` : ""}` : `${mins}m`;

  const clipUrl = buildClipUrl(streamUrl, timeWindow);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-secondary px-4 py-3">
        <h2 className="text-sm font-semibold text-primary">Preview</h2>
        <p className="mt-0.5 text-xs text-tertiary">
          {channel.title} — {fmt(timeWindow.startTime)} → {fmt(timeWindow.endTime)} ({durationLabel})
        </p>
      </div>
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-4">
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <VideoPreview streamUrl={streamUrl} timeWindow={timeWindow} />
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => onOpenEditor(channel, timeWindow, clipUrl, selectionMode)}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-solid-hover"
            >
              <Scissors01 className="size-4" />
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimePickerPreviewPanel({
  channel,
  streamUrl,
  timeWindow,
  tz,
  onOpenEditor,
}: {
  channel: Channel;
  streamUrl: string;
  timeWindow: TimeWindow;
  tz: string;
  onOpenEditor: (channel: Channel, tw: TimeWindow, clipUrl: string, mode: Live2VodWindowMode) => void;
}) {
  const fmt = (ts: number) =>
    new Date(ts * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });
  const durationSec = timeWindow.endTime - timeWindow.startTime;
  const mins = Math.round(durationSec / 60);

  const clipUrl = buildClipUrl(streamUrl, timeWindow);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-secondary px-4 py-3">
        <h2 className="text-sm font-semibold text-primary">Preview</h2>
        <p className="mt-0.5 text-xs text-tertiary">
          {channel.title} — {fmt(timeWindow.startTime)} → {fmt(timeWindow.endTime)} ({mins} min)
        </p>
      </div>
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-4">
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <VideoPreview streamUrl={streamUrl} timeWindow={timeWindow} />
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => onOpenEditor(channel, timeWindow, clipUrl, "timePicker")}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-solid-hover"
            >
              <Scissors01 className="size-4" />
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RealtimeNextPanel({
  streamUrl,
  channel,
  tz,
  onOpenEditor,
}: {
  streamUrl: string;
  channel: Channel;
  tz: string;
  onOpenEditor: (channel: Channel, tw: TimeWindow, clipUrl: string, mode: Live2VodWindowMode) => void;
}) {
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const wallFormatter = useDateFormatter({
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: tz,
  });

  const handleNext = () => {
    const start = Math.floor(Date.now() / 1000);
    onOpenEditor(channel, { startTime: start, endTime: start + 1 }, streamUrl, "realtime");
  };

  const nowWallLabel = wallFormatter.format(new Date());

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-secondary px-4 py-3">
        <h2 className="text-sm font-semibold text-primary">Realtime</h2>
        <p className="mt-0.5 text-xs text-tertiary">
          Sub-clips use wall time in <span className="font-mono text-secondary">{tz}</span>. Session t0 is the second you press
          Next; REC stores offsets from t0 (absolute boundary = t0 + offset).
        </p>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="max-w-md rounded-lg border border-secondary bg-secondary px-4 py-3 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-tertiary">Current wall clock</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-primary">{nowWallLabel}</p>
          <p className="mt-2 text-xs text-tertiary">
            After Next, this clock defines where clip boundaries fall: Mark In/Out times are that reference plus the elapsed
            seconds shown in the editor.
          </p>
        </div>
        <PlayCircle className="size-10 text-fg-quaternary" />
        <button
          type="button"
          onClick={handleNext}
          className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-solid-hover"
        >
          <Scissors01 className="size-4" />
          Next
        </button>
      </div>
    </div>
  );
}

function PreviewPlaceholder({
  windowMode,
  hasDateRange,
  hasPickerDate,
  pickerValid,
}: {
  windowMode: Live2VodWindowMode;
  hasDateRange: boolean;
  hasPickerDate: boolean;
  pickerValid: boolean;
}) {
  let message = "Select a channel and configure a time window.";
  if (windowMode === "epg") {
    message = hasDateRange
      ? "Adjust the time window on the timeline to preview the clip"
      : "Select a date range and time window first";
  } else if (windowMode === "timePicker") {
    message = hasPickerDate && pickerValid
      ? "Preview should appear above"
      : "Choose a date, start time (HH:MM), and duration inside the archive";
  } else if (windowMode === "realtime") {
    message = "Press Next to open the live editor";
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <PlayCircle className="mb-2 size-6 text-fg-quaternary" />
      <p className="text-sm font-medium text-primary">Preview</p>
      <p className="mt-1 max-w-sm text-center text-sm text-tertiary">{message}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-secondary">
          <Tv01 className="size-6 text-fg-quaternary" />
        </div>
        <p className="text-sm font-medium text-primary">No channel selected</p>
        <p className="mt-1 text-sm text-tertiary">Pick a channel from the list to continue</p>
      </div>
    </div>
  );
}
