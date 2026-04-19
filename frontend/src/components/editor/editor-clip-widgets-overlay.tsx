import { useCallback, useEffect, useRef, useState } from "react";
import { Edit03, Trash01 } from "@untitledui/icons";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import type { EditorClipTextWidget, EditorClipWidget, EditorClipWidgetLayout } from "@/types/editor";
import { cx } from "@/utils/cx";
import type { EditorWidgetViewportPx } from "./editor-widget-viewport";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function clampLayout(l: EditorClipWidgetLayout): EditorClipWidgetLayout {
  const w = clamp(l.w, 0.06, 1);
  const h = clamp(l.h, 0.06, 1);
  const x = clamp(l.x, 0, 1 - w);
  const y = clamp(l.y, 0, 1 - h);
  return { x, y, w, h };
}

/** Eight-point resize (design-tool style). */
type WidgetResizeEdge = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

function layoutForResize(edge: WidgetResizeEdge, o: EditorClipWidgetLayout, dx: number, dy: number): EditorClipWidgetLayout {
  let x = o.x;
  let y = o.y;
  let w = o.w;
  let h = o.h;
  if (edge.includes("e")) w = o.w + dx;
  if (edge.includes("w")) {
    x = o.x + dx;
    w = o.w - dx;
  }
  if (edge.includes("s")) h = o.h + dy;
  if (edge.includes("n")) {
    y = o.y + dy;
    h = o.h - dy;
  }
  return clampLayout({ x, y, w, h });
}

/** Floating toolbar: same light rounded icon style as editor (e.g. clip row actions). */
const floatingToolbarBtn = cx(
  "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-secondary bg-primary",
  "text-fg-quaternary transition-colors hover:bg-secondary hover:text-fg-secondary",
  "focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 outline-focus-ring",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-primary",
);

const floatingToolbarIcon = "size-4 shrink-0";

/** Resize knobs — larger hit target and square (no shadow). */
function WidgetResizeKnob({
  edge,
  onPointerDown,
}: {
  edge: WidgetResizeEdge;
  onPointerDown: (e: React.PointerEvent, edge: WidgetResizeEdge) => void;
}) {
  const pos: Record<WidgetResizeEdge, string> = {
    nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
    n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
    ne: "left-full top-0 -translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
    e: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
    se: "left-full top-full -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
    s: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
    sw: "left-0 top-full -translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
    w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  };

  return (
    <div
      data-widget-resize-handle={edge}
      role="presentation"
      className={cx(
        "pointer-events-auto absolute z-30 flex size-6 items-center justify-center touch-none select-none",
        pos[edge],
      )}
      onPointerDown={(e) => onPointerDown(e, edge)}
    >
      <div
        className="size-3.5 shrink-0 rounded-[2px] border border-neutral-900 bg-white"
        aria-hidden
      />
    </div>
  );
}

interface EditorClipWidgetsOverlayProps {
  viewport: EditorWidgetViewportPx;
  widgets: EditorClipWidget[];
  onWidgetsChange: (next: EditorClipWidget[]) => void;
  /** When set to a widget id that exists in `widgets`, that widget becomes selected once; then call `onFocusWidgetRequestHandled`. */
  focusWidgetIdRequest?: string | null;
  onFocusWidgetRequestHandled?: () => void;
}

function widgetPlainText(html: string): string {
  if (typeof document === "undefined") {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || "").replace(/\s+/g, " ").trim();
}

/** Empty or legacy default copy — preview + modal use the same default phrase. */
const TEXT_WIDGET_PLACEHOLDER_INNER_HTML = "<p>New text</p>";

/** Empty or legacy default copy — show placeholder line in preview. */
function isTextWidgetPlaceholderHtml(html: string): boolean {
  const t = widgetPlainText(html);
  return t === "" || t === "New text";
}

function modalInitialHtmlForTextWidget(html: string): string {
  return isTextWidgetPlaceholderHtml(html) ? TEXT_WIDGET_PLACEHOLDER_INNER_HTML : html;
}

export function EditorClipWidgetsOverlay({
  viewport,
  widgets,
  onWidgetsChange,
  focusWidgetIdRequest = null,
  onFocusWidgetRequestHandled,
}: EditorClipWidgetsOverlayProps) {
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [textEditModalId, setTextEditModalId] = useState<string | null>(null);
  const [modalColor, setModalColor] = useState("#ffffff");
  const [modalFontSizePx, setModalFontSizePx] = useState(28);
  const modalEditorRef = useRef<HTMLDivElement>(null);

  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  useEffect(() => {
    setSelectedWidgetId((cur) => {
      if (!cur) return null;
      return widgets.some((w) => w.id === cur) ? cur : null;
    });
  }, [widgets]);

  useEffect(() => {
    if (!focusWidgetIdRequest) return;
    if (!widgets.some((w) => w.id === focusWidgetIdRequest)) return;
    setSelectedWidgetId(focusWidgetIdRequest);
    onFocusWidgetRequestHandled?.();
  }, [focusWidgetIdRequest, widgets, onFocusWidgetRequestHandled]);

  const applyLayout = useCallback(
    (id: string, layout: EditorClipWidgetLayout) => {
      const list = widgetsRef.current;
      const next = list.map((w) => (w.id === id ? { ...w, layout: clampLayout(layout) } : w));
      onWidgetsChange(next);
    },
    [onWidgetsChange],
  );

  const patchTextWidget = useCallback(
    (id: string, patch: Partial<EditorClipTextWidget>) => {
      const list = widgetsRef.current;
      const next = list.map((w) => {
        if (w.id !== id || w.kind !== "text") return w;
        return { ...w, ...patch } as EditorClipTextWidget;
      });
      onWidgetsChange(next);
    },
    [onWidgetsChange],
  );

  const removeWidget = useCallback(
    (id: string) => {
      onWidgetsChange(widgetsRef.current.filter((w) => w.id !== id));
      setTextEditModalId((cur) => (cur === id ? null : cur));
      setSelectedWidgetId((cur) => (cur === id ? null : cur));
    },
    [onWidgetsChange],
  );

  useEffect(() => {
    if (!textEditModalId) return;
    const w = widgetsRef.current.find((x): x is EditorClipTextWidget => x.id === textEditModalId && x.kind === "text");
    if (!w) {
      setTextEditModalId(null);
      return;
    }
    setModalColor(w.color);
    setModalFontSizePx(Math.round(clamp(w.fontSizePx, 8, 120)));
    const id = requestAnimationFrame(() => {
      const el = modalEditorRef.current;
      if (el) el.innerHTML = modalInitialHtmlForTextWidget(w.html);
    });
    return () => cancelAnimationFrame(id);
  }, [textEditModalId]);

  const handleModalSave = useCallback(() => {
    if (!textEditModalId) return;
    const html = modalEditorRef.current?.innerHTML ?? "";
    patchTextWidget(textEditModalId, {
      html,
      color: modalColor,
      fontSizePx: Math.round(clamp(modalFontSizePx, 8, 120)),
    });
    setTextEditModalId(null);
  }, [textEditModalId, modalColor, modalFontSizePx, patchTextWidget]);

  const beginMove = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (e.button !== 0) return;
      const w = widgetsRef.current.find((x) => x.id === id);
      if (!w) return;
      e.preventDefault();
      e.stopPropagation();
      const originLayout = { ...w.layout };
      const originClientX = e.clientX;
      const originClientY = e.clientY;
      const pointerId = e.pointerId;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (viewport.w <= 0 || viewport.h <= 0) return;
        const dx = (ev.clientX - originClientX) / viewport.w;
        const dy = (ev.clientY - originClientY) / viewport.h;
        const s = originLayout;
        applyLayout(id, { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h });
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [applyLayout, viewport.w, viewport.h],
  );

  const beginResize = useCallback(
    (e: React.PointerEvent, id: string, edge: WidgetResizeEdge) => {
      if (e.button !== 0) return;
      const w = widgetsRef.current.find((x) => x.id === id);
      if (!w) return;
      e.preventDefault();
      e.stopPropagation();
      const originLayout = { ...w.layout };
      const originClientX = e.clientX;
      const originClientY = e.clientY;
      const pointerId = e.pointerId;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (viewport.w <= 0 || viewport.h <= 0) return;
        const dx = (ev.clientX - originClientX) / viewport.w;
        const dy = (ev.clientY - originClientY) / viewport.h;
        applyLayout(id, layoutForResize(edge, originLayout, dx, dy));
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [applyLayout, viewport.w, viewport.h],
  );

  if (viewport.w <= 0 || viewport.h <= 0) return null;

  const edges: WidgetResizeEdge[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  return (
    <>
      <div
        className="pointer-events-none absolute z-[12]"
        style={{
          left: viewport.x,
          top: viewport.y,
          width: viewport.w,
          height: viewport.h,
        }}
      >
        <div
          className="pointer-events-auto relative size-full overflow-visible"
          onPointerDownCapture={(e) => {
            const root = (e.target as HTMLElement).closest("[data-editor-clip-widget]");
            if (root) {
              const id = root.getAttribute("data-editor-clip-widget");
              if (id) setSelectedWidgetId(id);
            } else {
              setSelectedWidgetId(null);
            }
          }}
        >
          {widgets.map((w) => {
            const { x, y, width, height } = {
              x: `${w.layout.x * 100}%`,
              y: `${w.layout.y * 100}%`,
              width: `${w.layout.w * 100}%`,
              height: `${w.layout.h * 100}%`,
            };

            const isSelected = selectedWidgetId === w.id;

            return (
              <div
                key={w.id}
                data-editor-clip-widget={w.id}
                className="absolute h-full w-full overflow-visible"
                style={{ left: x, top: y, width, height }}
              >
                {/* Toolbar floats above the widget box so selection never shifts preview content. */}
                <div className="relative h-full w-full min-h-0">
                  {isSelected ? (
                    <div
                      className="pointer-events-auto absolute bottom-[calc(100%+0.375rem)] left-1/2 z-40 flex -translate-x-1/2 cursor-move flex-row items-center justify-center gap-2"
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        beginMove(e, w.id);
                      }}
                    >
                      <button
                        type="button"
                        className={floatingToolbarBtn}
                        title={w.kind === "text" ? "Edit text" : "Edit (text widgets only)"}
                        aria-label="Edit widget"
                        disabled={w.kind !== "text"}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (w.kind !== "text") return;
                          setTextEditModalId(w.id);
                        }}
                      >
                        <Edit03 className={floatingToolbarIcon} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={floatingToolbarBtn}
                        title="Delete widget"
                        aria-label="Delete widget"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeWidget(w.id);
                        }}
                      >
                        <Trash01 className={floatingToolbarIcon} aria-hidden />
                      </button>
                    </div>
                  ) : null}

                  <div className="flex h-full min-h-0 w-full flex-col overflow-visible">
                    <div
                      className={cx(
                        "relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[2px] bg-transparent",
                        isSelected ? "border-2 border-dashed border-white" : "border-2 border-transparent",
                      )}
                    >
                    <div
                      className={cx(
                        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                        isSelected ? "cursor-move" : "cursor-pointer",
                      )}
                      onPointerDown={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest("button") || t.closest("input") || t.closest("[data-widget-resize-handle]")) return;
                        beginMove(e, w.id);
                      }}
                    >
                      {w.kind === "text" ? (
                        <TextWidgetBody widget={w} viewportH={viewport.h} />
                      ) : (
                        <div className="flex min-h-0 flex-1 items-center justify-center bg-transparent p-2">
                          <img
                            src={w.src}
                            alt={w.originalName ?? "Widget image"}
                            className="max-h-full max-w-full object-contain"
                            draggable={false}
                          />
                        </div>
                      )}
                    </div>

                    {isSelected
                      ? edges.map((edge) => (
                          <WidgetResizeKnob key={edge} edge={edge} onPointerDown={(ev) => beginResize(ev, w.id, edge)} />
                        ))
                      : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {textEditModalId ? (
        <ModalOverlay
          isOpen
          onOpenChange={(open) => {
            if (!open) setTextEditModalId(null);
          }}
          isDismissable
          isKeyboardDismissDisabled={false}
          className="z-[85]"
        >
          <Modal className="z-[86]">
            <Dialog
              aria-label="Edit text widget"
              className="mx-4 flex w-full max-w-lg justify-center outline-hidden sm:mx-auto"
            >
              <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
                <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
                <h2 className="pr-10 text-lg font-semibold text-primary">Edit text widget</h2>
                <p className="mt-1 text-xs text-tertiary">Content, color, and size apply to the overlay on the player.</p>

                <div className="mt-4 flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-secondary">Color</span>
                    <input
                      type="color"
                      value={modalColor.length === 7 ? modalColor : "#ffffff"}
                      onChange={(e) => setModalColor(e.target.value)}
                      className="h-10 w-full max-w-[120px] cursor-pointer rounded-lg border border-secondary"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-secondary">Size (px)</span>
                    <input
                      type="number"
                      min={8}
                      max={120}
                      step={1}
                      inputMode="numeric"
                      value={Math.round(modalFontSizePx)}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!Number.isFinite(n)) return;
                        setModalFontSizePx(Math.round(clamp(n, 8, 120)));
                      }}
                      className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary tabular-nums"
                    />
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-secondary">Text</span>
                    <div
                      ref={modalEditorRef}
                      contentEditable
                      suppressContentEditableWarning
                      className={cx(
                        "min-h-[160px] rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-normal leading-relaxed text-primary outline-none",
                        "focus:border-brand focus:ring-1 focus:ring-brand-secondary/40",
                        "[&_*]:[color:inherit] [&_*]:[font-size:inherit] [&_*]:[font-family:inherit] [&_*]:[line-height:inherit]",
                      )}
                    />
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setTextEditModalId(null)}
                    className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleModalSave}
                    className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover"
                  >
                    Save
                  </button>
                </div>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}
    </>
  );
}

function TextWidgetBody({ widget, viewportH }: { widget: EditorClipTextWidget; viewportH: number }) {
  const previewFs =
    viewportH > 0 ? Math.max(12, Math.min(96, (widget.fontSizePx * viewportH) / 720)) : 16;

  if (isTextWidgetPlaceholderHtml(widget.html)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-transparent p-3">
        <span
          className="min-w-0 max-w-full overflow-hidden text-center font-bold leading-snug break-words"
          style={{ color: widget.color, fontSize: previewFs }}
        >
          New text
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-transparent p-3">
      <div
        className="min-w-0 max-h-full max-w-full overflow-hidden text-center font-bold leading-snug break-words [&_*]:max-w-full"
        style={{
          color: widget.color,
          fontSize: previewFs,
        }}
        dangerouslySetInnerHTML={{ __html: widget.html }}
      />
    </div>
  );
}
