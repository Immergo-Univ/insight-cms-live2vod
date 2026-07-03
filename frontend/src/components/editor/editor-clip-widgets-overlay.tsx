import { useCallback, useEffect, useRef, useState } from "react";
import { Edit03, FaceSmile, Trash01 } from "@untitledui/icons";
import EmojiPicker, { type EmojiClickData, EmojiStyle, Theme } from "emoji-picker-react";
import { ModalOverlay, Modal, Dialog } from "@/components/application/modals/modal";
import { CloseButton } from "@/components/base/buttons/close-button";
import type {
  EditorClipImageWidget,
  EditorClipTextWidget,
  EditorClipWidget,
  EditorClipWidgetLayout,
} from "@/types/editor";
import { cx } from "@/utils/cx";
import { FRAME_DURATION_SEC } from "./editor-constants";
import {
  clampClipTimeRange,
  filterRelativeTimeTyping,
  formatDigitsAsMaskedRelativeTime,
  formatTime,
  parseRelativeTimeInput,
} from "./editor-timeline";
import type { EditorWidgetViewportPx } from "./editor-widget-viewport";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

const TEXT_WIDGET_FONT_SIZE_MIN_PX = 4;
const TEXT_WIDGET_FONT_SIZE_MAX_PX = 300;

function clampLayout(l: EditorClipWidgetLayout): EditorClipWidgetLayout {
  const w = clamp(l.w, 0.06, 1);
  const h = clamp(l.h, 0.06, 1);
  const x = clamp(l.x, 0, 1 - w);
  const y = clamp(l.y, 0, 1 - h);
  return { x, y, w, h };
}

function insertEmojiIntoContentEditable(root: HTMLElement, savedRange: Range | null, emoji: string): void {
  root.focus();
  const sel = window.getSelection();
  if (!sel) return;

  let range: Range | null = null;
  if (savedRange) {
    try {
      const anchor = savedRange.commonAncestorContainer;
      if (root.contains(anchor) || anchor === root) {
        range = savedRange.cloneRange();
      }
    } catch {
      /* detached */
    }
  }
  if (!range && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0);
    if (root.contains(r.commonAncestorContainer)) {
      range = r.cloneRange();
    }
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }

  range.deleteContents();
  const textNode = document.createTextNode(emoji);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
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

export interface EditorClipWidgetsTimelineContext {
  clipStartSec: number;
  clipEndSec: number;
  playheadSec: number;
}

interface EditorClipWidgetsOverlayProps {
  viewport: EditorWidgetViewportPx;
  widgets: EditorClipWidget[];
  onWidgetsChange: (next: EditorClipWidget[]) => void;
  /** When set to a widget id that exists in `widgets`, that widget becomes selected once; then call `onFocusWidgetRequestHandled`. */
  focusWidgetIdRequest?: string | null;
  onFocusWidgetRequestHandled?: () => void;
  /** Mark In/Out of the selected sub-clip in parent-window seconds + current playhead (for offset preview). */
  timelineContext?: EditorClipWidgetsTimelineContext | null;
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

function clipDurationForOffsets(ctx: EditorClipWidgetsTimelineContext | null | undefined): number {
  if (!ctx) return 86_400;
  return Math.max(FRAME_DURATION_SEC, ctx.clipEndSec - ctx.clipStartSec);
}

function isWidgetVisibleOnPlayhead(
  w: EditorClipWidget,
  ctx: EditorClipWidgetsTimelineContext | null | undefined,
): boolean {
  if (!ctx) return true;
  const dur = ctx.clipEndSec - ctx.clipStartSec;
  if (!(dur > 0)) return true;
  const oi = w.offsetIn ?? 0;
  const oo = w.offsetOut ?? dur;
  const t = ctx.playheadSec;
  return t >= ctx.clipStartSec + oi && t < ctx.clipStartSec + oo;
}

export function EditorClipWidgetsOverlay({
  viewport,
  widgets,
  onWidgetsChange,
  focusWidgetIdRequest = null,
  onFocusWidgetRequestHandled,
  timelineContext = null,
}: EditorClipWidgetsOverlayProps) {
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [widgetEditModalId, setWidgetEditModalId] = useState<string | null>(null);
  const [modalColor, setModalColor] = useState("#ffffff");
  const [modalFontSizeStr, setModalFontSizeStr] = useState("28");
  /** Live text HTML mirror for the modal preview (contentEditable is uncontrolled). */
  const [modalPreviewHtml, setModalPreviewHtml] = useState(TEXT_WIDGET_PLACEHOLDER_INNER_HTML);
  const [modalOffsetInStr, setModalOffsetInStr] = useState("0:00");
  const [modalOffsetOutStr, setModalOffsetOutStr] = useState("0:00");
  const modalEditorRef = useRef<HTMLDivElement>(null);
  const widgetTextEmojiRangeRef = useRef<Range | null>(null);
  const emojiPickerButtonRef = useRef<HTMLButtonElement>(null);
  const emojiPickerPopoverRef = useRef<HTMLDivElement>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  const timelineContextRef = useRef(timelineContext);
  timelineContextRef.current = timelineContext;

  useEffect(() => {
    setSelectedWidgetId((cur) => {
      if (!cur) return null;
      return widgets.some((w) => w.id === cur) ? cur : null;
    });
  }, [widgets]);

  useEffect(() => {
    if (!widgetEditModalId) {
      setEmojiPickerOpen(false);
      widgetTextEmojiRangeRef.current = null;
    }
  }, [widgetEditModalId]);

  useEffect(() => {
    if (!emojiPickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (emojiPickerPopoverRef.current?.contains(t)) return;
      if (emojiPickerButtonRef.current?.contains(t)) return;
      setEmojiPickerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [emojiPickerOpen]);

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

  const patchWidget = useCallback(
    (
      id: string,
      patch: Partial<Pick<EditorClipTextWidget, "html" | "color" | "fontSizePx" | "offsetIn" | "offsetOut">> &
        Partial<Pick<EditorClipImageWidget, "offsetIn" | "offsetOut">>,
    ) => {
      const list = widgetsRef.current;
      const next = list.map((w) => (w.id !== id ? w : ({ ...w, ...patch } as EditorClipWidget)));
      onWidgetsChange(next);
    },
    [onWidgetsChange],
  );

  const removeWidget = useCallback(
    (id: string) => {
      onWidgetsChange(widgetsRef.current.filter((w) => w.id !== id));
      setWidgetEditModalId((cur) => (cur === id ? null : cur));
      setSelectedWidgetId((cur) => (cur === id ? null : cur));
    },
    [onWidgetsChange],
  );

  useEffect(() => {
    if (!widgetEditModalId) return;
    const w = widgetsRef.current.find((x) => x.id === widgetEditModalId);
    if (!w) {
      setWidgetEditModalId(null);
      return;
    }
    const maxDur = clipDurationForOffsets(timelineContextRef.current);
    const oi = w.offsetIn ?? 0;
    const oo = w.offsetOut ?? maxDur;
    setModalOffsetInStr(formatTime(oi));
    setModalOffsetOutStr(formatTime(oo));
    if (w.kind !== "text") return;
    const tw = w as EditorClipTextWidget;
    setModalColor(tw.color);
    setModalFontSizeStr(
      String(Math.round(clamp(tw.fontSizePx, TEXT_WIDGET_FONT_SIZE_MIN_PX, TEXT_WIDGET_FONT_SIZE_MAX_PX))),
    );
    setModalPreviewHtml(modalInitialHtmlForTextWidget(tw.html));
    const id = requestAnimationFrame(() => {
      const el = modalEditorRef.current;
      if (el) el.innerHTML = modalInitialHtmlForTextWidget(tw.html);
    });
    return () => cancelAnimationFrame(id);
  }, [widgetEditModalId]);

  const handleModalSave = useCallback(() => {
    if (!widgetEditModalId) return;
    const w = widgetsRef.current.find((x) => x.id === widgetEditModalId);
    if (!w) {
      setWidgetEditModalId(null);
      return;
    }
    const maxDur = clipDurationForOffsets(timelineContext);
    const a = parseRelativeTimeInput(modalOffsetInStr);
    const b = parseRelativeTimeInput(modalOffsetOutStr);
    if (a === null || b === null) {
      const oi = w.offsetIn ?? 0;
      const oo = w.offsetOut ?? maxDur;
      setModalOffsetInStr(formatTime(oi));
      setModalOffsetOutStr(formatTime(oo));
      return;
    }
    const r = clampClipTimeRange(a, b, maxDur, FRAME_DURATION_SEC);
    if (!r) {
      const oi = w.offsetIn ?? 0;
      const oo = w.offsetOut ?? maxDur;
      setModalOffsetInStr(formatTime(oi));
      setModalOffsetOutStr(formatTime(oo));
      return;
    }
    if (w.kind === "text") {
      const html = modalEditorRef.current?.innerHTML ?? "";
      let n = parseInt(modalFontSizeStr.trim(), 10);
      if (!Number.isFinite(n)) n = TEXT_WIDGET_FONT_SIZE_MIN_PX;
      patchWidget(widgetEditModalId, {
        html,
        color: modalColor,
        fontSizePx: Math.round(clamp(n, TEXT_WIDGET_FONT_SIZE_MIN_PX, TEXT_WIDGET_FONT_SIZE_MAX_PX)),
        offsetIn: r.startTime,
        offsetOut: r.endTime,
      });
    } else {
      patchWidget(widgetEditModalId, {
        offsetIn: r.startTime,
        offsetOut: r.endTime,
      });
    }
    setWidgetEditModalId(null);
  }, [
    widgetEditModalId,
    modalColor,
    modalFontSizeStr,
    modalOffsetInStr,
    modalOffsetOutStr,
    patchWidget,
    timelineContext,
  ]);

  const toggleWidgetTextEmojiPicker = useCallback(() => {
    setEmojiPickerOpen((prev) => {
      if (prev) {
        widgetTextEmojiRangeRef.current = null;
        return false;
      }
      const el = modalEditorRef.current;
      const sel = window.getSelection();
      widgetTextEmojiRangeRef.current = null;
      if (el && sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        if (el.contains(r.commonAncestorContainer)) {
          widgetTextEmojiRangeRef.current = r.cloneRange();
        }
      }
      return true;
    });
  }, []);

  const onWidgetTextEmojiPick = useCallback((data: EmojiClickData) => {
    const el = modalEditorRef.current;
    if (!el) return;
    insertEmojiIntoContentEditable(el, widgetTextEmojiRangeRef.current, data.emoji);
    widgetTextEmojiRangeRef.current = null;
    setEmojiPickerOpen(false);
    setModalPreviewHtml(el.innerHTML);
    requestAnimationFrame(() => el.focus());
  }, []);

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
  const offsetMaxSec = clipDurationForOffsets(timelineContext);
  const offsetTimePlaceholder = offsetMaxSec >= 3600 ? "h:mm:ss" : "m:ss";
  const offsetTimeTitle =
    offsetMaxSec >= 3600
      ? "Time as h:mm:ss, or type digits only (e.g. 10105 → 1:01:05). Two digits alone = total seconds."
      : "Time as m:ss, or type digits only (e.g. 130 → 1:30). One or two digits = total seconds.";
  const modalOffsetInputClass = cx(
    "w-full min-w-0 rounded-lg border border-secondary bg-primary px-3 py-2 text-center text-sm text-brand-secondary tabular-nums outline-none placeholder:text-placeholder",
    "focus:border-brand focus:ring-1 focus:ring-brand-secondary/30",
  );

  const handleModalOffsetMaskedChange = (raw: string, which: "in" | "out") => {
    const setStr = which === "in" ? setModalOffsetInStr : setModalOffsetOutStr;
    const filtered = filterRelativeTimeTyping(raw);
    if (filtered.includes(":")) {
      setStr(filtered);
      return;
    }
    setStr(formatDigitsAsMaskedRelativeTime(filtered, offsetMaxSec));
  };

  const editingWidget = widgetEditModalId ? widgets.find((x) => x.id === widgetEditModalId) ?? null : null;

  // Clamped numeric font size for the slider + preview (modalFontSizeStr is the source of truth).
  const modalFontSizeNum = (() => {
    const parsed = parseInt(modalFontSizeStr.trim(), 10);
    return Number.isFinite(parsed)
      ? Math.round(clamp(parsed, TEXT_WIDGET_FONT_SIZE_MIN_PX, TEXT_WIDGET_FONT_SIZE_MAX_PX))
      : TEXT_WIDGET_FONT_SIZE_MIN_PX;
  })();
  // Cap only the on-screen preview so huge sizes stay usable in the modal (real overlay is unbounded).
  const modalPreviewFontSize = Math.min(modalFontSizeNum, 140);

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
            const onPlayhead = isWidgetVisibleOnPlayhead(w, timelineContext);

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
                        title="Edit widget"
                        aria-label="Edit widget"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWidgetEditModalId(w.id);
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
                        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-opacity duration-150",
                        isSelected ? "cursor-move" : "cursor-pointer",
                        onPlayhead ? "opacity-100" : "opacity-35",
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

      {widgetEditModalId && editingWidget ? (
        <ModalOverlay
          isOpen
          onOpenChange={(open) => {
            if (!open) setWidgetEditModalId(null);
          }}
          isDismissable
          isKeyboardDismissDisabled={false}
        >
          <Modal>
            <Dialog
              aria-label="Edit widget"
              className="mx-4 flex w-full max-w-lg justify-center outline-hidden sm:mx-auto"
            >
              <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-secondary bg-primary p-5 shadow-xl">
                <CloseButton slot="close" size="xs" label="Close" className="absolute top-3 right-3 z-10" />
                <h2 className="pr-10 text-lg font-semibold text-primary">Edit widget</h2>
                <p className="mt-1 text-xs text-tertiary">
                  {editingWidget.kind === "text"
                    ? "Content, color, and size apply to the overlay on the player."
                    : "Image or animated GIF (alpha supported): position and size on the preview; offsets control visibility in the encoded output."}
                </p>

                <div className="mt-4 flex flex-col gap-3">
                  <div className="rounded-lg border border-secondary bg-secondary/40 px-3 py-2.5">
                    <p className="text-xs font-medium text-secondary">Offset In / Offset Out</p>
                    <p className="mt-1 text-xs leading-relaxed text-tertiary">
                      Times are measured from this clip&apos;s Mark In (the same origin as Mark In / Mark Out on the
                      timeline). The overlay is shown only while playback is within that range; encoded VOD uses the
                      same timing on each output segment (including after ad cuts).
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-secondary">Offset In</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          spellCheck={false}
                          className={modalOffsetInputClass}
                          aria-label="Widget offset in"
                          placeholder={offsetTimePlaceholder}
                          title={offsetTimeTitle}
                          value={modalOffsetInStr}
                          onChange={(e) => handleModalOffsetMaskedChange(e.target.value, "in")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-secondary">Offset Out</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          spellCheck={false}
                          className={modalOffsetInputClass}
                          aria-label="Widget offset out"
                          placeholder={offsetTimePlaceholder}
                          title={offsetTimeTitle}
                          value={modalOffsetOutStr}
                          onChange={(e) => handleModalOffsetMaskedChange(e.target.value, "out")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {editingWidget.kind === "text" ? (
                    <>
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
                          type="range"
                          min={TEXT_WIDGET_FONT_SIZE_MIN_PX}
                          max={TEXT_WIDGET_FONT_SIZE_MAX_PX}
                          step={1}
                          aria-label="Widget text size in pixels"
                          value={modalFontSizeNum}
                          onChange={(e) => setModalFontSizeStr(String(e.target.value))}
                          className="w-full accent-brand-solid"
                        />
                        <span className="text-xs text-tertiary tabular-nums">{modalFontSizeNum}px</span>
                      </label>

                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-secondary">Preview</span>
                        <div className="flex max-h-[200px] min-h-[96px] items-center justify-center overflow-hidden rounded-lg border border-secondary bg-black/90 px-3 py-3">
                          <div
                            className="max-w-full overflow-hidden text-center font-bold leading-snug break-words [&_*]:[color:inherit] [&_*]:[font-size:inherit] [&_*]:[font-family:inherit] [&_*]:[line-height:inherit]"
                            style={{ color: modalColor.length === 7 ? modalColor : "#ffffff", fontSize: modalPreviewFontSize }}
                            dangerouslySetInnerHTML={{ __html: modalPreviewHtml || "<p></p>" }}
                          />
                        </div>
                        <span className="text-[11px] text-tertiary">
                          Approximate look of the overlay; on the player it scales with video height.
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="relative flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-secondary">Text</span>
                          <button
                            ref={emojiPickerButtonRef}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={toggleWidgetTextEmojiPicker}
                            aria-expanded={emojiPickerOpen}
                            aria-haspopup="dialog"
                            aria-controls="widget-text-emoji-picker"
                            className={cx(
                              "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-secondary bg-primary px-2.5 py-1.5 text-xs font-medium text-secondary transition-colors",
                              "hover:bg-secondary hover:text-primary",
                              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
                            )}
                          >
                            <FaceSmile data-icon className="size-4 shrink-0 text-fg-quaternary" aria-hidden />
                            Emojis
                          </button>
                          {emojiPickerOpen ? (
                            <div
                              id="widget-text-emoji-picker"
                              ref={emojiPickerPopoverRef}
                              className="absolute top-full right-0 z-50 mt-1 overflow-hidden rounded-xl border border-secondary bg-primary shadow-lg"
                              role="dialog"
                              aria-label="Emoji picker"
                            >
                              <EmojiPicker
                                onEmojiClick={onWidgetTextEmojiPick}
                                theme={Theme.AUTO}
                                emojiStyle={EmojiStyle.NATIVE}
                                width={320}
                                height={360}
                                searchPlaceHolder="Search (English keywords)"
                                autoFocusSearch
                                lazyLoadEmojis
                              />
                            </div>
                          ) : null}
                        </div>
                        <div
                          ref={modalEditorRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={(e) => setModalPreviewHtml((e.target as HTMLDivElement).innerHTML)}
                          className={cx(
                            "min-h-[160px] rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-normal leading-relaxed text-primary outline-none",
                            "focus:border-brand focus:ring-1 focus:ring-brand-secondary/40",
                            "[&_*]:[color:inherit] [&_*]:[font-size:inherit] [&_*]:[font-family:inherit] [&_*]:[line-height:inherit]",
                          )}
                        />
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setWidgetEditModalId(null)}
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
