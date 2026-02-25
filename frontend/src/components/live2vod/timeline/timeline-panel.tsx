import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DateValue, RangeValue } from "react-aria-components";
import { now as intlNow } from "@internationalized/date";
import { TimelineCurrentTime } from "./timeline-current-time";
import { TimelinePrograms } from "./timeline-programs";
import { TimelineRuler, PX_PER_MINUTE, MINUTES_PER_TICK } from "./timeline-ruler";
import { TimelineSelection } from "./timeline-selection";
import { useTimezone } from "@/hooks/use-timezone";
import type { EpgEvent } from "@/types/channel";

export interface TimeWindow {
  startTime: number;
  endTime: number;
}

interface TimelinePanelProps {
  dateRange: RangeValue<DateValue>;
  epgEvents?: EpgEvent[];
  onTimeWindowChange?: (tw: TimeWindow) => void;
}

export function TimelinePanel({ dateRange, epgEvents = [], onTimeWindowChange }: TimelinePanelProps) {
  const tz = useTimezone();
  const scrollRef = useRef<HTMLDivElement>(null);

  const startDate = useMemo(() => {
    return dateRange.start.toDate(tz);
  }, [dateRange.start, tz]);

  const endDate = useMemo(() => {
    const d = dateRange.end.toDate(tz);
    return new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
  }, [dateRange.end, tz]);

  const totalMinutes = useMemo(() => {
    const diffMs = endDate.getTime() - startDate.getTime();
    return Math.ceil(diffMs / (1000 * 60));
  }, [startDate, endDate]);

  const totalDays = useMemo(() => {
    return Math.ceil(totalMinutes / (24 * 60));
  }, [totalMinutes]);

  const [selTop, setSelTop] = useState(0);
  const [selBottom, setSelBottom] = useState(60);

  useEffect(() => {
    const nowMs = intlNow(tz).toDate().getTime();
    const nowMinutes = (nowMs - startDate.getTime()) / (1000 * 60);
    const snap = (v: number) => Math.round(v / MINUTES_PER_TICK) * MINUTES_PER_TICK;

    const bottom = snap(Math.min(nowMinutes, totalMinutes));
    const top = snap(Math.max(0, bottom - 60));

    setSelTop(top);
    setSelBottom(bottom);
  }, [startDate, totalMinutes, tz]);

  useEffect(() => {
    if (!onTimeWindowChange) return;
    const startMs = startDate.getTime() + selTop * 60_000;
    const endMs = startDate.getTime() + selBottom * 60_000;
    onTimeWindowChange({
      startTime: Math.floor(startMs / 1000),
      endTime: Math.floor(endMs / 1000),
    });
  }, [selTop, selBottom, startDate, onTimeWindowChange]);

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

  const handleProgramClick = useCallback((startMin: number, endMin: number) => {
    setSelTop(startMin);
    setSelBottom(endMin);
  }, []);

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
          tz={tz}
        />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative ml-14" style={{ height: totalHeight }}>
          <TimelineRuler
            totalMinutes={totalMinutes}
            startDate={startDate}
            tz={tz}
            onTickClick={handleTickClick}
          />

          <TimelinePrograms
            events={epgEvents}
            startDate={startDate}
            totalMinutes={totalMinutes}
            onProgramClick={handleProgramClick}
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
  tz,
}: {
  startDate: Date;
  topMinutes: number;
  bottomMinutes: number;
  tz: string;
}) {
  const from = new Date(startDate.getTime() + topMinutes * 60_000);
  const to = new Date(startDate.getTime() + bottomMinutes * 60_000);

  const fmt = (d: Date) =>
    d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
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
