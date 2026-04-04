import { Phone01 } from "@untitledui/icons";

interface EditorVerticalCropButtonProps {
  active: boolean;
  onToggle: () => void;
}

export function EditorVerticalCropButton({ active, onToggle }: EditorVerticalCropButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border bg-primary shadow-lg transition-colors hover:bg-secondary ${
        active ? "border-brand border-2 ring-2 ring-brand-secondary/40" : "border-secondary"
      }`}
      title={active ? "Disable vertical crop" : "Vertical video crop (9:16)"}
      aria-label={active ? "Disable vertical crop" : "Enable vertical crop"}
      aria-pressed={active}
    >
      <Phone01 className="size-4.5 text-fg-quaternary" aria-hidden />
    </button>
  );
}
