import { useCallback, useRef, useState } from "react";
import { ArrowLeft, Play } from "@untitledui/icons";
import { useLocation, useNavigate } from "react-router";
import {
  EditorPlayer,
  EditorTimeline,
  EditorTransportControls,
  EditorMarkInOut,
  EditorClipsList,
  EditorJsonButton,
  EditorRightPanel,
  EditorCapturePreview,
  formatTime,
} from "@/components/editor";
import type { EditorPlayerRef } from "@/components/editor";
import type {
  EditorClipState,
  EditorPosterEntry,
  EditorStateJson,
  EditorSubClip,
} from "@/types/editor";

export function EditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const clipState = location.state as EditorClipState | null;

  const playerRef = useRef<EditorPlayerRef>(null);
  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(1);
  const [posters, setPosters] = useState<EditorPosterEntry[]>([]);
  const [clips, setClips] = useState<EditorSubClip[]>([]);
  const [markInTime, setMarkInTime] = useState<number | null>(null);

  const handleBack = () => navigate(-1);

  const handlePlay = useCallback(() => {
    playerRef.current?.play();
  }, []);

  const handlePause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const handleStop = useCallback(() => {
    playerRef.current?.pause();
    playerRef.current?.seek(0);
  }, []);

  const handlePlayStartClip = useCallback(() => {
    if (markInTime === null) return;
    playerRef.current?.seek(markInTime);
    playerRef.current?.play();
  }, [markInTime]);

  const handlePlayEndClip = useCallback(() => {
    const endTime = Math.max(0, currentTime - 5);
    playerRef.current?.seek(endTime);
    playerRef.current?.play();
  }, [currentTime]);

  const handleMarkIn = useCallback((timeSeconds: number) => {
    setMarkInTime(timeSeconds);
  }, []);

  const handleMarkOut = useCallback(
    (timeSeconds: number) => {
      if (markInTime === null || timeSeconds <= markInTime) return;
      const nextOrder =
        clips.length === 0 ? 1 : Math.max(...clips.map((c) => c.order)) + 1;
      setClips((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          order: nextOrder,
          startTime: markInTime,
          endTime: timeSeconds,
        },
      ]);
      setMarkInTime(null);
    },
    [markInTime, clips.length]
  );

  const handleRemoveClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleOrderChange = useCallback((id: string, newOrder: number) => {
    setClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, order: newOrder } : c))
    );
  }, []);

  const handleCapturePoster = useCallback(() => {
    const t = playerRef.current?.getCurrentTime() ?? currentTime;
    setPosters((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        timeSeconds: t,
        orientation: "landscape",
        capturedAt: new Date().toISOString(),
      },
    ]);
  }, [currentTime]);

  const handleRemovePoster = useCallback((id: string) => {
    setPosters((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleSeek = useCallback((timeSeconds: number) => {
    playerRef.current?.seek(timeSeconds);
  }, []);

  if (!clipState?.clipUrl) {
    return (
      <div className="flex h-full flex-col bg-primary">
        <header className="flex items-center gap-3 border-b border-secondary px-4 py-3">
          <button
            onClick={handleBack}
            className="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-secondary"
          >
            <ArrowLeft className="size-4 text-fg-quaternary" />
          </button>
          <h1 className="text-lg font-semibold text-primary">Live2VOD</h1>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="text-sm text-tertiary">No clip data. Select a time window first.</p>
          <button
            onClick={handleBack}
            className="rounded-lg border border-secondary px-4 py-2 text-sm font-medium text-primary hover:bg-secondary"
          >
            Go back
          </button>
        </main>
      </div>
    );
  }

  const durationSeconds = clipState.endTime - clipState.startTime;
  const effectiveDuration = duration > 0 ? duration : durationSeconds;
  const channelId = clipState.channelId ?? "";
  const segmentDuration =
    markInTime !== null ? currentTime - markInTime : 0;

  const stateJson: EditorStateJson = {
    clipUrl: clipState.clipUrl,
    sourceM3u8: clipState.sourceM3u8,
    startTime: clipState.startTime,
    endTime: clipState.endTime,
    posters,
    clips: clips.map((c) => ({ order: c.order, startTime: c.startTime, endTime: c.endTime })),
  };

  return (
    <div className="flex h-full flex-col bg-primary">
      <header className="flex shrink-0 items-center gap-3 border-b border-secondary px-4 py-3">
        <button
          onClick={handleBack}
          className="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-secondary"
          aria-label="Go back"
        >
          <ArrowLeft className="size-4 text-fg-quaternary" />
        </button>
        <h1 className="text-lg font-semibold text-primary">Live2VOD Editor</h1>
      </header>

      <main className="flex min-h-0 flex-1 flex-row overflow-hidden">
        {/* Left column: Player, Timeline, Clipping */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* 1. Video player (~2/3) + Capture & Preview (~1/3) */}
          <section className="flex shrink-0 gap-4">
            <div className="min-w-0 flex-[2]">
              <EditorPlayer
                ref={playerRef}
                clipUrl={clipState.clipUrl}
                muted={muted}
                onMutedChange={setMuted}
                onTimeUpdate={setCurrentTime}
                onDurationChange={setDuration}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            </div>
            <div className="min-w-0 flex-1 basis-0">
              <EditorCapturePreview
                posters={posters}
                currentTimeSeconds={currentTime}
                onCapture={handleCapturePoster}
                onRemovePoster={handleRemovePoster}
                onSeek={handleSeek}
                getVideoElement={() => playerRef.current?.getVideoElement() ?? null}
              />
            </div>
          </section>

          {/* 2. Timeline + Zoom */}
          <section className="shrink-0">
            <EditorTimeline
              durationSeconds={effectiveDuration}
              currentTimeSeconds={currentTime}
              clipUrl={clipState.clipUrl}
              channelId={channelId}
              zoomIndex={zoomIndex}
              onZoomIndexChange={setZoomIndex}
              onSeek={handleSeek}
              clips={clips}
              onRemoveClip={handleRemoveClip}
            />
          </section>

          {/* 3. Clipping: Transport, previews, Mark In/Out, Play start/end, duration */}
          <section className="flex flex-col gap-3 rounded-lg border border-secondary bg-secondary p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary">
              Clipping
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <EditorTransportControls
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
                isPlaying={isPlaying}
              />
              <EditorMarkInOut
                currentTimeSeconds={currentTime}
                markInTime={markInTime}
                onMarkIn={handleMarkIn}
                onMarkOut={handleMarkOut}
                getVideoElement={() => playerRef.current?.getVideoElement() ?? null}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handlePlayStartClip}
                disabled={markInTime === null}
                className="flex items-center gap-1.5 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary disabled:opacity-50"
              >
                <Play className="size-4" />
                Play start clip
              </button>
              <button
                type="button"
                onClick={handlePlayEndClip}
                className="flex items-center gap-1.5 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
              >
                <Play className="size-4" />
                Play end clip
              </button>
              {markInTime !== null && (
                <span className="text-xs text-tertiary">
                  Segment duration: {formatTime(Math.max(0, segmentDuration))}
                </span>
              )}
            </div>
            <EditorClipsList
              clips={clips}
              onOrderChange={handleOrderChange}
              onRemove={handleRemoveClip}
              onSeek={handleSeek}
            />
          </section>
        </div>

        {/* Right column: Metadata only */}
        <aside className="flex shrink-0 overflow-y-auto border-l border-secondary py-4 pl-4 pr-4">
          <EditorRightPanel />
        </aside>
      </main>

      {/* Footer: Back (left), Create and Finish (right) */}
      <footer className="flex shrink-0 items-center justify-between border-t border-secondary px-4 py-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
          >
            Back
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-solid-hover"
          >
            Create and Finish
          </button>
        </div>
      </footer>

      <EditorJsonButton stateJson={stateJson} />
    </div>
  );
}
