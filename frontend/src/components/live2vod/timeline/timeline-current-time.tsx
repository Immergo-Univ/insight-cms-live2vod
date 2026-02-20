import { useEffect, useState } from "react";
import { PX_PER_MINUTE } from "./timeline-ruler";

interface TimelineCurrentTimeProps {
  startDate: Date;
}

function getMinutesSinceStart(startDate: Date): number {
  const now = new Date();
  return (now.getTime() - startDate.getTime()) / (1000 * 60);
}

export function TimelineCurrentTime({ startDate }: TimelineCurrentTimeProps) {
  const [minutes, setMinutes] = useState(() => getMinutesSinceStart(startDate));

  useEffect(() => {
    setMinutes(getMinutesSinceStart(startDate));
    const id = setInterval(() => {
      setMinutes(getMinutesSinceStart(startDate));
    }, 30_000);
    return () => clearInterval(id);
  }, [startDate]);

  if (minutes < 0) return null;

  const top = minutes * PX_PER_MINUTE;

  return (
    <div
      className="pointer-events-none absolute left-0 z-30 flex w-full items-center"
      style={{ top }}
    >
      <div className="size-1.5 rounded-full bg-error-solid" />
      <div className="h-px flex-1 bg-error-solid" />
    </div>
  );
}
