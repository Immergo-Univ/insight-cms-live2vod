import { Play, PauseCircle, StopCircle } from "@untitledui/icons";

interface EditorTransportControlsProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  isPlaying?: boolean;
}

export function EditorTransportControls({
  onPlay,
  onPause,
  onStop,
  isPlaying = false,
}: EditorTransportControlsProps) {
  return (
    <div className="flex items-center gap-1">
      {isPlaying ? (
        <button
          type="button"
          onClick={onPause}
          className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-secondary bg-primary text-fg-secondary transition-colors hover:bg-secondary"
          aria-label="Pause"
        >
          <PauseCircle className="size-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPlay}
          className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-secondary bg-primary text-fg-secondary transition-colors hover:bg-secondary"
          aria-label="Play"
        >
          <Play className="size-5" />
        </button>
      )}
      <button
        type="button"
        onClick={onStop}
        className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-secondary bg-primary text-fg-secondary transition-colors hover:bg-secondary"
        aria-label="Stop"
      >
        <StopCircle className="size-5" />
      </button>
    </div>
  );
}
