import { useMemo } from "react";
import type { Channel } from "@/types/channel";

export interface ChannelDateRange {
  startDate: Date;
  endDate: Date;
}

export function useChannelDateRange(channel: Channel | null) {
  const range = useMemo<ChannelDateRange | null>(() => {
    if (!channel) return null;

    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 3);
    start.setHours(0, 0, 0, 0);

    return { startDate: start, endDate: now };
  }, [channel]);

  return { range, loading: false, error: null };
}
