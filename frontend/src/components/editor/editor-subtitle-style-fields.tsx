import type { EditorSubtitleStyle } from "@/types/editor";

interface EditorSubtitleStyleFieldsProps {
  style: EditorSubtitleStyle;
  onChange: (next: EditorSubtitleStyle) => void;
  disabled?: boolean;
}

/** Visual burn-in style controls (font, colors, outline). */
export function EditorSubtitleStyleFields({ style, onChange, disabled = false }: EditorSubtitleStyleFieldsProps) {
  const wrap = disabled ? "pointer-events-none opacity-50" : "";

  return (
    <div className={`flex flex-col gap-4 ${wrap}`}>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-secondary">Font size (px)</span>
        <input
          type="range"
          min={12}
          max={72}
          value={style.fontSizePx}
          onChange={(e) => onChange({ ...style, fontSizePx: Number(e.target.value) })}
          className="w-full accent-brand-solid"
        />
        <span className="text-xs text-tertiary">{style.fontSizePx}px</span>
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-secondary">Text color</span>
          <input
            type="color"
            value={style.textColor}
            onChange={(e) => onChange({ ...style, textColor: e.target.value })}
            className="h-10 w-20 cursor-pointer rounded border border-secondary bg-primary"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-secondary">Outline color</span>
          <input
            type="color"
            value={style.outlineColor}
            onChange={(e) => onChange({ ...style, outlineColor: e.target.value })}
            className="h-10 w-20 cursor-pointer rounded border border-secondary bg-primary"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-secondary">Outline width (px)</span>
        <input
          type="range"
          min={0}
          max={12}
          value={style.outlineWidthPx}
          onChange={(e) => onChange({ ...style, outlineWidthPx: Number(e.target.value) })}
          className="w-full accent-brand-solid"
        />
        <span className="text-xs text-tertiary">{style.outlineWidthPx}px</span>
      </label>
    </div>
  );
}
