import { useCallback, useState } from "react";
import { Trash01 } from "@untitledui/icons";
import type { EditorSubClip } from "@/types/editor";
import { formatTime } from "./editor-timeline";

interface EditorClipsListProps {
  clips: EditorSubClip[];
  onOrderChange: (id: string, newOrder: number) => void;
  onRemove: (id: string) => void;
  onSeek?: (timeSeconds: number) => void;
}

export function EditorClipsList({
  clips,
  onOrderChange,
  onRemove,
  onSeek,
}: EditorClipsListProps) {
  const sortedClips = [...clips].sort((a, b) => a.order - b.order);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const handleOrderFocus = useCallback((c: EditorSubClip) => {
    setEditingId(c.id);
    setEditingValue(String(c.order));
  }, []);

  const handleOrderBlur = useCallback(
    (id: string, value: string) => {
      const n = parseInt(value, 10);
      if (!Number.isNaN(n) && n >= 1) onOrderChange(id, n);
      setEditingId(null);
    },
    [onOrderChange]
  );

  if (clips.length === 0) {
    return (
      <div className="rounded-lg border border-secondary bg-secondary px-3 py-2 text-xs text-tertiary">
        No sub-clips. Use Mark In / Mark Out to add ranges.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-secondary">Sub-clips (output order)</p>
      <ul className="flex flex-col gap-1.5">
        {sortedClips.map((c) => {
          const dur = c.endTime - c.startTime;
          const isEditing = editingId === c.id;
          return (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-secondary bg-secondary px-3 py-2 text-sm"
            >
              <label className="flex items-center gap-1">
                <span className="text-tertiary">Order</span>
                <input
                  type="number"
                  min={1}
                  value={isEditing ? editingValue : c.order}
                  onChange={(e) => isEditing && setEditingValue(e.target.value)}
                  onFocus={() => handleOrderFocus(c)}
                  onBlur={() => handleOrderBlur(c.id, isEditing ? editingValue : String(c.order))}
                  className="w-12 rounded border border-secondary bg-primary px-1.5 py-0.5 text-xs text-primary"
                />
              </label>
              <button
                type="button"
                onClick={() => onSeek?.(c.startTime)}
                className="font-mono text-xs text-brand-secondary hover:underline"
              >
                {formatTime(c.startTime)} → {formatTime(c.endTime)}
              </button>
              <span className="text-tertiary">({formatTime(dur)})</span>
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                className="ml-auto rounded p-1 text-fg-quaternary hover:bg-tertiary hover:text-fg-secondary"
                aria-label="Remove sub-clip"
              >
                <Trash01 className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
