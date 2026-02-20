import { useState } from "react";
import { Clock, PlayCircle, Tv01 } from "@untitledui/icons";
import { ClipJsonButton } from "@/components/live2vod/clip-json-button";
import { useDateFormatter } from "react-aria";
import type { DateValue, RangeValue } from "react-aria-components";
import { ChannelDatePicker } from "@/components/live2vod/channel-date-picker";
import { ChannelList } from "@/components/live2vod/channel-list";
import type { TimeWindow } from "@/components/live2vod/timeline/timeline-panel";
import { TimelinePanel } from "@/components/live2vod/timeline/timeline-panel";
import { VideoPreview } from "@/components/live2vod/video-preview";
import { useChannelDateRange } from "@/hooks/use-channel-date-range";
import { useChannels } from "@/hooks/use-channels";
import { useTimezone } from "@/hooks/use-timezone";
import type { Channel } from "@/types/channel";

export function Live2VodPage() {
  const tz = useTimezone();
  const { channels, loading, error } = useChannels();
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [dateRange, setDateRange] = useState<RangeValue<DateValue> | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow | null>(null);
  const { range: availableRange } = useChannelDateRange(selectedChannel, tz);

  const handleSelectChannel = (channel: Channel) => {
    setSelectedChannel(channel);
    setDateRange(null);
    setTimeWindow(null);
  };

  return (
    <div className="flex h-full flex-col bg-primary">
      <header className="flex items-center border-b border-secondary px-6 py-3">
        <h1 className="text-lg font-semibold text-primary">Live2VOD</h1>
      </header>

      <main className="flex min-h-0 flex-1">
        {/* Panel 1: Channel list */}
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
            {/* Panel 2: Calendar (compact) */}
            <div className="flex w-72 shrink-0 flex-col border-r border-secondary">
              <ChannelHeader channel={selectedChannel} />
              <div className="flex-1 overflow-y-auto p-3">
                {availableRange && (
                  <CalendarPanel
                    availableRange={availableRange}
                    dateRange={dateRange}
                    onDateRangeChange={setDateRange}
                    tz={tz}
                  />
                )}
              </div>
            </div>

            {/* Panel 3: Timeline */}
            <div className="flex w-80 shrink-0 flex-col border-r border-secondary">
              {dateRange ? (
                <TimelinePanel
                  dateRange={dateRange}
                  epgEvents={selectedChannel.epgEvents}
                  onTimeWindowChange={setTimeWindow}
                />
              ) : (
                <TimelinePlaceholder />
              )}
            </div>

            {/* Panel 4: Video preview */}
            <div className="flex flex-1 flex-col">
              {timeWindow && selectedChannel ? (
                <PreviewPanel
                  streamUrl={selectedChannel.hlsStream}
                  timeWindow={timeWindow}
                  channelTitle={selectedChannel.title}
                  tz={tz}
                />
              ) : (
                <PreviewPlaceholder hasTimeline={!!dateRange} />
              )}
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </main>

      <ClipJsonButton
        streamUrl={selectedChannel?.hlsStream ?? null}
        timeWindow={timeWindow}
      />
    </div>
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
      <p className="truncate text-sm font-semibold text-primary">
        {channel.title}
      </p>
    </div>
  );
}

function CalendarPanel({
  availableRange,
  dateRange,
  onDateRangeChange,
  tz,
}: {
  availableRange: NonNullable<ReturnType<typeof useChannelDateRange>["range"]>;
  dateRange: RangeValue<DateValue> | null;
  onDateRangeChange: (value: RangeValue<DateValue>) => void;
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
    <div className="flex flex-col gap-3">
      <div className="rounded-lg bg-secondary px-3 py-2">
        <p className="text-xs text-tertiary">Available archive</p>
        <p className="mt-0.5 text-xs font-medium text-primary">
          {startLocal} — {endLocal}
        </p>
      </div>

      <ChannelDatePicker
        availableRange={availableRange}
        value={dateRange}
        onChange={onDateRangeChange}
      />

      {dateRange && (
        <SelectedRangeInfo dateRange={dateRange} tz={tz} />
      )}
    </div>
  );
}

function SelectedRangeInfo({ dateRange, tz }: { dateRange: RangeValue<DateValue>; tz: string }) {
  const formatter = useDateFormatter({ month: "short", day: "numeric", year: "numeric", timeZone: tz });
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
  streamUrl,
  timeWindow,
  channelTitle,
  tz,
}: {
  streamUrl: string;
  timeWindow: TimeWindow;
  channelTitle: string;
  tz: string;
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
  const durationLabel = hours > 0
    ? `${hours}h ${mins > 0 ? `${mins}m` : ""}`
    : `${mins}m`;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-secondary px-4 py-3">
        <h2 className="text-sm font-semibold text-primary">Preview</h2>
        <p className="mt-0.5 text-xs text-tertiary">
          {channelTitle} — {fmt(timeWindow.startTime)} → {fmt(timeWindow.endTime)} ({durationLabel})
        </p>
      </div>
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-4">
        <div className="w-full max-w-3xl">
          <VideoPreview streamUrl={streamUrl} timeWindow={timeWindow} />
        </div>
      </div>
    </div>
  );
}

function PreviewPlaceholder({ hasTimeline }: { hasTimeline: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <PlayCircle className="mb-2 size-6 text-fg-quaternary" />
      <p className="text-sm font-medium text-primary">Preview</p>
      <p className="mt-1 text-center text-sm text-tertiary">
        {hasTimeline
          ? "Adjust the time window to preview the clip"
          : "Select a date range and time window first"}
      </p>
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
        <p className="mt-1 text-sm text-tertiary">
          Pick a channel from the list to continue
        </p>
      </div>
    </div>
  );
}
