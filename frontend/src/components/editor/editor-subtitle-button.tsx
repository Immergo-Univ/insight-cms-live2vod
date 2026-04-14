import { Globe01 } from "@untitledui/icons";

interface EditorSubtitleButtonProps {
  active: boolean;
  onToggle: () => void;
  /** `inline` = compact control for a clip row; `toolbar` = footer-sized (default). */
  variant?: "toolbar" | "inline";
}

export function EditorSubtitleButton({
  active,
  onToggle,
  variant = "toolbar",
}: EditorSubtitleButtonProps) {
  const isInline = variant === "inline";
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex shrink-0 cursor-pointer items-center justify-center border bg-primary transition-colors hover:bg-secondary ${
        isInline
          ? `size-8 rounded-full ${active ? "border-brand border-2 ring-1 ring-brand-secondary/40" : "border-secondary"}`
          : `size-10 rounded-full shadow-lg ${active ? "border-brand border-2 ring-2 ring-brand-secondary/40" : "border-secondary"}`
      }`}
      title={active ? "Disable burned-in subtitles" : "Burned-in subtitles (whisper.cpp)"}
      aria-label={active ? "Disable subtitles" : "Enable subtitles"}
      aria-pressed={active}
    >
      <Globe01 className={`text-fg-quaternary ${isInline ? "size-3.5" : "size-4.5"}`} aria-hidden />
    </button>
  );
}
