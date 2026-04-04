import { Globe01 } from "@untitledui/icons";

interface EditorSubtitleButtonProps {
  active: boolean;
  onToggle: () => void;
}

export function EditorSubtitleButton({ active, onToggle }: EditorSubtitleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border bg-primary shadow-lg transition-colors hover:bg-secondary ${
        active ? "border-brand border-2 ring-2 ring-brand-secondary/40" : "border-secondary"
      }`}
      title={active ? "Disable burned-in subtitles" : "Burned-in subtitles (whisper.cpp)"}
      aria-label={active ? "Disable subtitles" : "Enable subtitles"}
      aria-pressed={active}
    >
      <Globe01 className="size-4.5 text-fg-quaternary" aria-hidden />
    </button>
  );
}
