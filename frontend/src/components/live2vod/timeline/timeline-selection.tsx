import { useCallback, useRef } from "react";
import { MINUTES_PER_TICK, PX_PER_MINUTE } from "./timeline-ruler";

interface TimelineSelectionProps {
  topMinutes: number;
  bottomMinutes: number;
  maxMinutes: number;
  onChange: (top: number, bottom: number) => void;
}

function snapToTick(minutes: number): number {
  return Math.round(minutes / MINUTES_PER_TICK) * MINUTES_PER_TICK;
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export function TimelineSelection({
  topMinutes,
  bottomMinutes,
  maxMinutes,
  onChange,
}: TimelineSelectionProps) {
  const dragging = useRef<"top" | "bottom" | null>(null);
  const startY = useRef(0);
  const startVal = useRef(0);

  const handleMouseDown = useCallback(
    (edge: "top" | "bottom") => (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = edge;
      startY.current = e.clientY;
      startVal.current = edge === "top" ? topMinutes : bottomMinutes;

      const onMove = (ev: MouseEvent) => {
        const delta = (ev.clientY - startY.current) / PX_PER_MINUTE;
        const raw = startVal.current + delta;
        const snapped = snapToTick(raw);

        if (edge === "top") {
          const clamped = clamp(snapped, 0, bottomMinutes - MINUTES_PER_TICK);
          onChange(clamped, bottomMinutes);
        } else {
          const clamped = clamp(snapped, topMinutes + MINUTES_PER_TICK, maxMinutes);
          onChange(topMinutes, clamped);
        }
      };

      const onUp = () => {
        dragging.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [topMinutes, bottomMinutes, maxMinutes, onChange],
  );

  const top = topMinutes * PX_PER_MINUTE;
  const height = (bottomMinutes - topMinutes) * PX_PER_MINUTE;

  return (
    <div
      className="absolute left-12 right-0 z-20"
      style={{ top, height }}
    >
      {/* Selection area */}
      <div className="absolute inset-0 bg-brand-solid/15 border-x-2 border-brand-solid" />

      {/* Top handle */}
      <div
        onMouseDown={handleMouseDown("top")}
        className="group absolute left-0 right-0 z-30 flex h-3 -translate-y-1/2 cursor-row-resize items-center justify-center"
        style={{ top: 0 }}
      >
        <div className="h-0.5 w-full bg-brand-solid" />
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-brand-solid px-2 py-0.5 text-[9px] font-medium text-white shadow-sm">
          {formatMinutes(topMinutes)}
        </div>
      </div>

      {/* Bottom handle */}
      <div
        onMouseDown={handleMouseDown("bottom")}
        className="group absolute left-0 right-0 z-30 flex h-3 translate-y-1/2 cursor-row-resize items-center justify-center"
        style={{ bottom: 0 }}
      >
        <div className="h-0.5 w-full bg-brand-solid" />
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-brand-solid px-2 py-0.5 text-[9px] font-medium text-white shadow-sm">
          {formatMinutes(bottomMinutes)}
        </div>
      </div>
    </div>
  );
}

function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
