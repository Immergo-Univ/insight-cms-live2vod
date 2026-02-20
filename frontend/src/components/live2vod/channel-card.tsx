import { Tv01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import type { Channel } from "@/types/channel";

interface ChannelCardProps {
  channel: Channel;
  isSelected: boolean;
  onSelect: (channel: Channel) => void;
}

export function ChannelCard({ channel, isSelected, onSelect }: ChannelCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(channel)}
      className={cx(
        "group flex w-full items-center gap-3 rounded-xl text-left",
        "transition duration-100 ease-linear",
        isSelected
          ? "border-2 border-brand bg-brand-primary p-[11px]"
          : "border border-secondary bg-primary p-3 hover:border-secondary_hover hover:bg-primary_hover",
      )}
    >
      <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-secondary">
        {channel.posterUrl ? (
          <img
            src={channel.posterUrl}
            alt={channel.title}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Tv01 className="size-6 text-fg-quaternary" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cx(
            "truncate text-sm font-medium",
            isSelected ? "text-brand-secondary" : "text-primary",
          )}
        >
          {channel.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-tertiary">
          {channel.hlsStream ? "Live with archive" : "No stream"}
        </p>
      </div>

      <div
        className={cx(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition duration-100 ease-linear",
          isSelected
            ? "border-brand-solid bg-brand-solid"
            : "border-primary bg-primary group-hover:border-secondary_hover",
        )}
      >
        {isSelected && (
          <div className="size-2 rounded-full bg-white" />
        )}
      </div>
    </button>
  );
}
