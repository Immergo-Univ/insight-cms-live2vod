const PX_PER_MINUTE = 1;
const MINUTES_PER_TICK = 10;
const TICK_HEIGHT = PX_PER_MINUTE * MINUTES_PER_TICK;

interface TimelineRulerProps {
  totalMinutes: number;
  startDate: Date;
  onTickClick?: (minuteOffset: number) => void;
}

export function TimelineRuler({ totalMinutes, startDate, onTickClick }: TimelineRulerProps) {
  const totalTicks = Math.floor(totalMinutes / MINUTES_PER_TICK);
  const totalHeight = totalMinutes * PX_PER_MINUTE;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onTickClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minute = Math.round(y / (PX_PER_MINUTE * MINUTES_PER_TICK)) * MINUTES_PER_TICK;
    onTickClick(Math.max(0, Math.min(minute, totalMinutes)));
  };

  return (
    <div
      className="absolute inset-0 cursor-pointer"
      style={{ height: totalHeight }}
      onClick={handleClick}
    >
      {Array.from({ length: totalTicks + 1 }, (_, i) => {
        const minuteOffset = i * MINUTES_PER_TICK;
        const top = minuteOffset * PX_PER_MINUTE;
        const isHour = minuteOffset % 60 === 0;
        const hourIndex = Math.floor(minuteOffset / 60);
        const displayHour = hourIndex % 24;
        const dayIndex = Math.floor(hourIndex / 24);

        const labelDate = new Date(startDate);
        labelDate.setDate(labelDate.getDate() + dayIndex);

        const label = `${String(displayHour).padStart(2, "0")}:${String(minuteOffset % 60).padStart(2, "0")}`;

        return (
          <div
            key={i}
            className="pointer-events-none absolute left-0 w-full"
            style={{ top }}
          >
            <div
              className={isHour ? "border-t border-secondary" : "border-t border-tertiary"}
            />
            {isHour && (
              <span className="absolute -top-2.5 left-1 text-[10px] leading-none text-tertiary">
                {label}
                {displayHour === 0 && (
                  <span className="ml-1 font-medium text-secondary">
                    {labelDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                )}
              </span>
            )}
          </div>
        );
      })}

      {/* Bottom border */}
      <div className="pointer-events-none absolute left-0 w-full border-t border-secondary" style={{ top: totalHeight }} />
    </div>
  );
}

export { PX_PER_MINUTE, MINUTES_PER_TICK, TICK_HEIGHT };
