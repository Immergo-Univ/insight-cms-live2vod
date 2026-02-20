import { useMemo } from "react";
import type { EpgEvent } from "@/types/channel";
import { PX_PER_MINUTE, MINUTES_PER_TICK } from "./timeline-ruler";

interface TimelineProgramsProps {
  events: EpgEvent[];
  startDate: Date;
  totalMinutes: number;
  tz: string;
  onProgramClick: (startMinute: number, endMinute: number) => void;
}

interface PositionedEvent {
  title: string;
  topMinutes: number;
  durationMinutes: number;
}

export function TimelinePrograms({
  events,
  startDate,
  totalMinutes,
  tz,
  onProgramClick,
}: TimelineProgramsProps) {
  const positioned = useMemo(() => {
    const startMs = startDate.getTime();
    const endMs = startMs + totalMinutes * 60_000;

    if (events.length > 0) {
      const dates = events.map((e) => e.start).sort();
      console.log(
        `[EPG] ${events.length} events, range: ${dates[0]} → ${dates[dates.length - 1]}. Timeline: ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}`,
      );
    }

    return events.reduce<PositionedEvent[]>((acc, ev) => {
      const evStartMs = new Date(ev.start).getTime();
      const evEndMs = new Date(ev.end).getTime();

      if (evEndMs <= startMs || evStartMs >= endMs) return acc;

      const clampedStart = Math.max(evStartMs, startMs);
      const clampedEnd = Math.min(evEndMs, endMs);

      const topMinutes = (clampedStart - startMs) / 60_000;
      const durationMinutes = (clampedEnd - clampedStart) / 60_000;

      if (durationMinutes < 1) return acc;

      acc.push({ title: ev.title, topMinutes, durationMinutes });
      return acc;
    }, []);
  }, [events, startDate, totalMinutes]);

  if (positioned.length === 0) return null;

  return (
    <>
      {positioned.map((ev, i) => {
        const top = ev.topMinutes * PX_PER_MINUTE;
        const height = ev.durationMinutes * PX_PER_MINUTE;

        const handleClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          const snapStart = Math.round(ev.topMinutes / MINUTES_PER_TICK) * MINUTES_PER_TICK;
          const snapEnd = Math.min(
            Math.round((ev.topMinutes + ev.durationMinutes) / MINUTES_PER_TICK) * MINUTES_PER_TICK,
            totalMinutes,
          );
          onProgramClick(snapStart, snapEnd);
        };

        return (
          <div
            key={`${ev.title}-${i}`}
            className="absolute left-12 right-0 z-10 cursor-pointer overflow-hidden border-y border-l-2 border-brand-solid/30 border-l-brand-solid/60 bg-brand-solid/8 transition-colors hover:bg-brand-solid/15"
            style={{ top, height }}
            onClick={handleClick}
            title={ev.title}
          >
            <span className="block truncate px-1.5 pt-0.5 text-[10px] leading-tight font-medium text-brand-secondary">
              {ev.title}
            </span>
          </div>
        );
      })}
    </>
  );
}
