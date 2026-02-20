import { AlertCircle, SearchLg } from "@untitledui/icons";
import { useState } from "react";
import { ChannelCard } from "./channel-card";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { LoadingIndicator } from "@/components/application/loading-indicator/loading-indicator";
import type { Channel } from "@/types/channel";

interface ChannelListProps {
  channels: Channel[];
  loading: boolean;
  error: string | null;
  selectedChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
}

export function ChannelList({
  channels,
  loading,
  error,
  selectedChannel,
  onSelectChannel,
}: ChannelListProps) {
  const [search, setSearch] = useState("");

  const filtered = channels.filter((ch) =>
    ch.title.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingIndicator size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <FeaturedIcon icon={AlertCircle} color="error" theme="light" size="lg" />
        <div>
          <p className="text-sm font-medium text-primary">Failed to load channels</p>
          <p className="mt-1 text-sm text-tertiary">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative mb-3">
        <SearchLg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-quaternary" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search channels..."
          className="w-full rounded-lg border border-secondary bg-primary py-2 pl-9 pr-3 text-sm text-primary placeholder:text-placeholder focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-tertiary">
            {channels.length === 0 ? "No channels available" : "No results found"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto pr-1">
          {filtered.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              isSelected={selectedChannel?.id === channel.id}
              onSelect={onSelectChannel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
