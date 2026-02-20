import { useMemo } from "react";
import { now, today } from "@internationalized/date";
import type { Channel } from "@/types/channel";

export interface ChannelDateRange {
  startDate: Date;
  endDate: Date;
}

export function useChannelDateRange(channel: Channel | null, tz: string) {
  const range = useMemo<ChannelDateRange | null>(() => {
    if (!channel) return null;

    const startCalDate = today(tz).subtract({ days: 3 });
    const startDate = startCalDate.toDate(tz);
    const endDate = now(tz).toDate();

    return { startDate, endDate };
  }, [channel, tz]);

  return { range, loading: false, error: null };
}
