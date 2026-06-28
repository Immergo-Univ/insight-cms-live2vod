import { Film03 } from "@untitledui/icons";

interface EditorSubtitleBurnButtonProps {
  active: boolean;
  onClick: () => void;
  variant?: "toolbar" | "inline";
  disabled?: boolean;
}

export function EditorSubtitleBurnButton({
  active,
  onClick,
  variant = "toolbar",
  disabled = false,
}: EditorSubtitleBurnButtonProps) {
  const isInline = variant === "inline";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center border bg-primary transition-colors ${
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-secondary"
      } ${
        isInline
          ? `size-8 rounded-full ${active ? "border-brand border-2 ring-1 ring-brand-secondary/40" : "border-secondary"}`
          : `size-10 rounded-full shadow-lg ${active ? "border-brand border-2 ring-2 ring-brand-secondary/40" : "border-secondary"}`
      }`}
      title={active ? "Burn-in subtitles on" : "Configure burn-in subtitles"}
      aria-label={active ? "Burn-in subtitles on" : "Configure burn-in subtitles"}
      aria-pressed={active}
    >
      <Film03 className={`text-fg-quaternary ${isInline ? "size-3.5" : "size-4.5"}`} aria-hidden />
    </button>
  );
}
