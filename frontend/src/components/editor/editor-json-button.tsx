import { useState } from "react";
import { File06 } from "@untitledui/icons";
import type { EditorStateJson } from "@/types/editor";

interface EditorJsonButtonProps {
  stateJson: EditorStateJson | null;
}

export function EditorJsonButton({ stateJson }: EditorJsonButtonProps) {
  const [open, setOpen] = useState(false);

  if (!stateJson) return null;

  const json = JSON.stringify(stateJson, null, 2);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open && (
        <div className="absolute bottom-12 right-0 w-96 rounded-lg border border-secondary bg-primary shadow-xl">
          <div className="flex items-center justify-between border-b border-secondary px-3 py-2">
            <span className="text-xs font-semibold text-primary">JSON</span>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(json)}
              className="cursor-pointer rounded px-2 py-0.5 text-[10px] font-medium text-brand-secondary hover:bg-secondary"
            >
              Copy
            </button>
          </div>
          <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-relaxed text-secondary">
            {json}
          </pre>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex size-10 cursor-pointer items-center justify-center rounded-full border border-secondary bg-primary shadow-lg transition-colors hover:bg-secondary"
        title="JSON"
        aria-label="Toggle JSON state"
      >
        <File06 className="size-4.5 text-fg-quaternary" />
      </button>
    </div>
  );
}
