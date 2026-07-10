import { useCallback, useEffect, useRef, useState } from "react";
import { Typography } from "antd";

export type RoiPx = { x: number; y: number; w: number; h: number };

type Props = {
  /** Base (native) resolution the ROI is expressed against. */
  baseW: number;
  baseH: number;
  /** Current ROI in native pixels. */
  value: RoiPx;
  onChange: (roi: RoiPx) => void;
  /** Max rendered width (scaled down like the Player, so it never blows up the layout). */
  maxWidth?: number;
};

type DragMode = "draw" | "move" | "resize";
type DragState = { mode: DragMode; handle?: string; startX: number; startY: number; orig: RoiPx };

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const HANDLE_CURSOR: Record<string, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

/**
 * Visual ROI picker: a box with the STREAM aspect ratio (scaled down) where a green rectangle can
 * be drawn from scratch, moved, or resized by its handles. Emits the ROI in NATIVE pixels (1:1 with
 * the base resolution) so the numeric inputs and the detection stay pixel-accurate.
 */
export function RoiSelector({ baseW, baseH, value, onChange, maxWidth = 520 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [cw, setCw] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = baseW > 0 && cw > 0 ? cw / baseW : 0; // display px per native px

  const emit = useCallback(
    (r: RoiPx) => {
      onChange({
        x: clamp(Math.round(r.x), 0, baseW),
        y: clamp(Math.round(r.y), 0, baseH),
        w: clamp(Math.round(r.w), 0, baseW),
        h: clamp(Math.round(r.h), 0, baseH),
      });
    },
    [baseW, baseH, onChange],
  );

  const pointerNative = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / scale, 0, baseW),
      y: clamp((e.clientY - rect.top) / scale, 0, baseH),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scale <= 0) return;
    const target = e.target as HTMLElement;
    const handle = target.dataset.handle;
    const role = target.dataset.role;
    const { x, y } = pointerNative(e);
    if (handle) {
      dragRef.current = { mode: "resize", handle, startX: x, startY: y, orig: { ...value } };
    } else if (role === "rect") {
      dragRef.current = { mode: "move", startX: x, startY: y, orig: { ...value } };
    } else {
      dragRef.current = { mode: "draw", startX: x, startY: y, orig: { ...value } };
      emit({ x, y, w: 0, h: 0 });
    }
    ref.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || scale <= 0) return;
    const { x: px, y: py } = pointerNative(e);

    if (d.mode === "draw") {
      emit({ x: Math.min(d.startX, px), y: Math.min(d.startY, py), w: Math.abs(px - d.startX), h: Math.abs(py - d.startY) });
      return;
    }
    if (d.mode === "move") {
      const dx = px - d.startX;
      const dy = py - d.startY;
      emit({
        x: clamp(d.orig.x + dx, 0, baseW - d.orig.w),
        y: clamp(d.orig.y + dy, 0, baseH - d.orig.h),
        w: d.orig.w,
        h: d.orig.h,
      });
      return;
    }
    // resize
    let l = d.orig.x;
    let t = d.orig.y;
    let r = d.orig.x + d.orig.w;
    let b = d.orig.y + d.orig.h;
    const h = d.handle || "";
    if (h.includes("w")) l = px;
    if (h.includes("e")) r = px;
    if (h.includes("n")) t = py;
    if (h.includes("s")) b = py;
    emit({ x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  if (!(baseW > 0 && baseH > 0)) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        —
      </Typography.Text>
    );
  }

  const disp = { x: value.x * scale, y: value.y * scale, w: value.w * scale, h: value.h * scale };
  const hasRect = value.w > 0 && value.h > 0;

  // Handle center positions (display px) relative to the rect.
  const handlePos: Record<string, { left: number; top: number }> = {
    nw: { left: disp.x, top: disp.y },
    n: { left: disp.x + disp.w / 2, top: disp.y },
    ne: { left: disp.x + disp.w, top: disp.y },
    e: { left: disp.x + disp.w, top: disp.y + disp.h / 2 },
    se: { left: disp.x + disp.w, top: disp.y + disp.h },
    s: { left: disp.x + disp.w / 2, top: disp.y + disp.h },
    sw: { left: disp.x, top: disp.y + disp.h },
    w: { left: disp.x, top: disp.y + disp.h / 2 },
  };

  return (
    <div style={{ maxWidth, width: "100%" }}>
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: `${baseW} / ${baseH}`,
          background:
            "repeating-conic-gradient(#2a2a2a 0% 25%, #232323 0% 50%) 50% / 24px 24px",
          borderRadius: 6,
          overflow: "hidden",
          cursor: "crosshair",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        {hasRect && (
          <div
            data-role="rect"
            style={{
              position: "absolute",
              left: disp.x,
              top: disp.y,
              width: disp.w,
              height: disp.h,
              border: "2px solid #52c41a",
              background: "rgba(82,196,26,0.18)",
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
              cursor: "move",
              zIndex: 1,
            }}
          />
        )}
        {hasRect &&
          HANDLES.map((h) => (
            <div
              key={h}
              data-handle={h}
              style={{
                position: "absolute",
                left: handlePos[h].left - 5,
                top: handlePos[h].top - 5,
                width: 10,
                height: 10,
                background: "#fff",
                border: "1px solid #52c41a",
                borderRadius: 2,
                cursor: HANDLE_CURSOR[h],
                zIndex: 2,
              }}
            />
          ))}
      </div>
    </div>
  );
}

export default RoiSelector;
