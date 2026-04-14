import { Phone01 } from "@untitledui/icons";

interface EditorVerticalCropButtonProps {
  active: boolean;
  onToggle: () => void;
  /** `inline` = compact control for a clip row; `toolbar` = footer-sized (default). */
  variant?: "toolbar" | "inline";
  disabled?: boolean;
}

export function EditorVerticalCropButton({
  active,
  onToggle,
  variant = "toolbar",
  disabled = false,
}: EditorVerticalCropButtonProps) {
  const isInline = variant === "inline";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`flex shrink-0 items-center justify-center border bg-primary transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-45"
          : "cursor-pointer hover:bg-secondary"
      } ${
        isInline
          ? `size-8 rounded-full ${active ? "border-brand border-2 ring-1 ring-brand-secondary/40" : "border-secondary"}`
          : `size-10 rounded-full shadow-lg ${active ? "border-brand border-2 ring-2 ring-brand-secondary/40" : "border-secondary"}`
      }`}
      title={active ? "Disable vertical crop" : "Vertical video crop (9:16)"}
      aria-label={active ? "Disable vertical crop" : "Enable vertical crop"}
      aria-pressed={active}
    >
      <Phone01 className={`text-fg-quaternary ${isInline ? "size-3.5" : "size-4.5"}`} aria-hidden />
    </button>
  );
}
