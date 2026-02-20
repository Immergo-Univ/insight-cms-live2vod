import { useState } from "react";
import { getLocalTimeZone } from "@internationalized/date";
import { Clock, Tv01 } from "@untitledui/icons";
import { useDateFormatter } from "react-aria";
import type { DateValue, RangeValue } from "react-aria-components";
import { ChannelDatePicker } from "@/components/live2vod/channel-date-picker";
import { ChannelList } from "@/components/live2vod/channel-list";
import { useChannelDateRange } from "@/hooks/use-channel-date-range";
import { useChannels } from "@/hooks/use-channels";
import type { Channel } from "@/types/channel";

export function Live2VodPage() {
  const { channels, loading, error } = useChannels();
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [dateRange, setDateRange] = useState<RangeValue<DateValue> | null>(null);
  const { range: availableRange } = useChannelDateRange(selectedChannel);

  const handleSelectChannel = (channel: Channel) => {
    setSelectedChannel(channel);
    setDateRange(null);
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
                  />
                )}
              </div>
            </div>

            {/* Panel 3: Timeline (takes remaining space) */}
            <div className="flex flex-1 flex-col">
              <TimelinePlaceholder hasDateRange={!!dateRange} />
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </main>
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
}: {
  availableRange: NonNullable<ReturnType<typeof useChannelDateRange>["range"]>;
  dateRange: RangeValue<DateValue> | null;
  onDateRangeChange: (value: RangeValue<DateValue>) => void;
}) {
  const startLocal = availableRange.startDate.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
  });
  const endLocal = availableRange.endDate.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
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
        <SelectedRangeInfo dateRange={dateRange} />
      )}
    </div>
  );
}

function SelectedRangeInfo({ dateRange }: { dateRange: RangeValue<DateValue> }) {
  const tz = getLocalTimeZone();
  const formatter = useDateFormatter({ month: "short", day: "numeric", year: "numeric" });
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

function TimelinePlaceholder({ hasDateRange }: { hasDateRange: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <Clock className="mb-2 size-6 text-fg-quaternary" />
      <p className="text-sm font-medium text-primary">Timeline</p>
      <p className="mt-1 text-center text-sm text-tertiary">
        {hasDateRange
          ? "Date range selected — timeline will appear here"
          : "Select a date range to enable the timeline"}
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
