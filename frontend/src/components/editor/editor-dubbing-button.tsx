import { Microphone01 } from "@untitledui/icons";

interface EditorDubbingButtonProps {
  active: boolean;
  onClick: () => void;
  variant?: "toolbar" | "inline";
  disabled?: boolean;
}

export function EditorDubbingButton({
  active,
  onClick,
  variant = "toolbar",
  disabled = false,
}: EditorDubbingButtonProps) {
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
      title={active ? "AI dubbing on" : "Configure AI dubbing"}
      aria-label={active ? "AI dubbing on" : "Configure AI dubbing"}
      aria-pressed={active}
    >
      <Microphone01 className={`text-fg-quaternary ${isInline ? "size-3.5" : "size-4.5"}`} aria-hidden />
    </button>
  );
}
