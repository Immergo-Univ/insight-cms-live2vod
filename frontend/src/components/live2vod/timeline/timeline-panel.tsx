import { useCallback, useMemo, useRef, useState } from "react";
import type { DateValue, RangeValue } from "react-aria-components";
import { getLocalTimeZone } from "@internationalized/date";
import { TimelineCurrentTime } from "./timeline-current-time";
import { TimelineRuler, PX_PER_MINUTE, MINUTES_PER_TICK } from "./timeline-ruler";
import { TimelineSelection } from "./timeline-selection";

interface TimelinePanelProps {
  dateRange: RangeValue<DateValue>;
}

function dateValueToDate(dv: DateValue): Date {
  return dv.toDate(getLocalTimeZone());
}

export function TimelinePanel({ dateRange }: TimelinePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const startDate = useMemo(() => {
    const d = dateValueToDate(dateRange.start);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [dateRange.start]);

  const endDate = useMemo(() => {
    const d = dateValueToDate(dateRange.end);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [dateRange.end]);

  const totalMinutes = useMemo(() => {
    const diffMs = endDate.getTime() - startDate.getTime();
    return Math.ceil(diffMs / (1000 * 60));
  }, [startDate, endDate]);

  const totalDays = useMemo(() => {
    return Math.ceil(totalMinutes / (24 * 60));
  }, [totalMinutes]);

  const defaultTop = Math.max(0, totalMinutes - 4 * 60);
  const defaultBottom = Math.min(totalMinutes, defaultTop + 2 * 60);

  const [selTop, setSelTop] = useState(() =>
    Math.round(defaultTop / MINUTES_PER_TICK) * MINUTES_PER_TICK,
  );
  const [selBottom, setSelBottom] = useState(() =>
    Math.round(defaultBottom / MINUTES_PER_TICK) * MINUTES_PER_TICK,
  );

  const handleSelectionChange = useCallback((top: number, bottom: number) => {
    setSelTop(top);
    setSelBottom(bottom);
  }, []);

  const handleTickClick = useCallback(
    (minuteOffset: number) => {
      const snapped = Math.round(minuteOffset / MINUTES_PER_TICK) * MINUTES_PER_TICK;
      const top = snapped;
      const bottom = Math.min(snapped + 60, totalMinutes);
      setSelTop(top);
      setSelBottom(bottom);
    },
    [totalMinutes],
  );

  const totalHeight = totalMinutes * PX_PER_MINUTE;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-secondary px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-primary">Timeline</h2>
          <p className="mt-0.5 text-xs text-tertiary">
            {totalDays} {totalDays === 1 ? "day" : "days"} — drag handles to select time window
          </p>
        </div>
        <SelectionSummary
          startDate={startDate}
          topMinutes={selTop}
          bottomMinutes={selBottom}
        />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative ml-14" style={{ height: totalHeight }}>
          <TimelineRuler
            totalMinutes={totalMinutes}
            startDate={startDate}
            onTickClick={handleTickClick}
          />

          <TimelineCurrentTime startDate={startDate} />

          <TimelineSelection
            topMinutes={selTop}
            bottomMinutes={selBottom}
            maxMinutes={totalMinutes}
            onChange={handleSelectionChange}
          />
        </div>
      </div>
    </div>
  );
}

function SelectionSummary({
  startDate,
  topMinutes,
  bottomMinutes,
}: {
  startDate: Date;
  topMinutes: number;
  bottomMinutes: number;
}) {
  const from = new Date(startDate.getTime() + topMinutes * 60_000);
  const to = new Date(startDate.getTime() + bottomMinutes * 60_000);

  const fmt = (d: Date) =>
    d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const durationMin = bottomMinutes - topMinutes;
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;
  const durationLabel = hours > 0
    ? `${hours}h ${mins > 0 ? `${mins}m` : ""}`
    : `${mins}m`;

  return (
    <div className="text-right">
      <p className="text-xs font-medium text-brand-secondary">
        {fmt(from)} — {fmt(to)}
      </p>
      <p className="text-[10px] text-tertiary">
        Duration: {durationLabel}
      </p>
    </div>
  );
}
