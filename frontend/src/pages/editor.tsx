import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Play } from "@untitledui/icons";
import { useLocation, useNavigate } from "react-router";
import {
  EditorPlayer,
  EditorTimeline,
  EditorClipsList,
  EditorJsonButton,
  EditorRightPanel,
  EditorCapturePreview,
  formatTime,
} from "@/components/editor";
import { FRAME_DURATION_SEC } from "@/components/editor/editor-constants";
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
  /** When set, Play plays only up to this time then pauses (for "play subclip"). */
  const [playUntilTime, setPlayUntilTime] = useState<number | null>(null);
  /** Subclip in "edit" mode: Mark In/Out update this clip; Play plays only this subclip. */
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  /** Subclip currently playing (from list row Play). Cleared on pause or when play reaches end. */
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  /** When set, we're playing the full sequence (order 1..N); value = current segment index. */
  const [playingSequenceIndex, setPlayingSequenceIndex] = useState<number | null>(null);

  const sortedClips = useMemo(
    () => [...clips].sort((a, b) => a.order - b.order),
    [clips]
  );

  // Clear selection if the selected clip was removed (e.g. from timeline)
  useEffect(() => {
    if (selectedClipId && !clips.some((c) => c.id === selectedClipId)) {
      setSelectedClipId(null);
    }
  }, [selectedClipId, clips]);

  // Arrow keys: move playhead by 1 frame (skip when focus is in input/textarea/select)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input") || target.closest("textarea") || target.closest("select")) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const t = playerRef.current?.getCurrentTime() ?? currentTime;
      const dur = playerRef.current?.getDuration() ?? duration;
      const next =
        e.key === "ArrowLeft"
          ? Math.max(0, t - FRAME_DURATION_SEC)
          : Math.min(dur, t + FRAME_DURATION_SEC);
      playerRef.current?.seek(next);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentTime, duration]);

  const handleBack = () => navigate(-1);

  // When playing a subclip, pause at its end
  useEffect(() => {
    if (!isPlaying || playUntilTime === null) return;
    if (currentTime >= playUntilTime) {
      playerRef.current?.pause();
      setPlayUntilTime(null);
      setPlayingClipId(null);
    }
  }, [isPlaying, playUntilTime, currentTime]);

  // When playing full sequence (1..N), jump to next subclip start at each segment end
  useEffect(() => {
    if (!isPlaying || playingSequenceIndex === null || sortedClips.length === 0) return;
    const seg = sortedClips[playingSequenceIndex];
    if (!seg) return;
    const endThreshold = seg.endTime - 0.05;
    const playerTime = playerRef.current?.getCurrentTime();
    const effectiveTime =
      typeof playerTime === "number" && !Number.isNaN(playerTime) && Math.abs(playerTime - currentTime) <= 0.25
        ? playerTime
        : currentTime;
    if (effectiveTime < endThreshold) return;
    const nextIndex = playingSequenceIndex + 1;
    if (nextIndex >= sortedClips.length) {
      playerRef.current?.pause();
      setPlayingSequenceIndex(null);
      return;
    }
    setPlayingSequenceIndex(nextIndex);
    const nextStartTime = sortedClips[nextIndex].startTime;
    playerRef.current?.seek(nextStartTime);
    setCurrentTime(nextStartTime);
    playerRef.current?.play();
  }, [isPlaying, playingSequenceIndex, currentTime, sortedClips]);

  const handlePlay = useCallback(() => {
    if (selectedClipId) {
      const clip = clips.find((c) => c.id === selectedClipId);
      if (clip) {
        setPlayUntilTime(clip.endTime);
        playerRef.current?.seek(clip.startTime);
        playerRef.current?.play();
        return;
      }
    }
    playerRef.current?.play();
  }, [selectedClipId, clips]);

  const handlePause = useCallback(() => {
    playerRef.current?.pause();
    setPlayingClipId(null);
    setPlayingSequenceIndex(null);
  }, []);

  const handlePlaySubclip = useCallback((clip: EditorSubClip) => {
    setPlayingClipId(clip.id);
    setPlayUntilTime(clip.endTime);
    playerRef.current?.seek(clip.startTime);
    playerRef.current?.play();
  }, []);

  const handleStop = useCallback(() => {
    playerRef.current?.pause();
    playerRef.current?.seek(0);
    setPlayUntilTime(null);
    setPlayingClipId(null);
    setPlayingSequenceIndex(null);
  }, []);

  const handlePlayFullSequence = useCallback(() => {
    if (sortedClips.length === 0) return;
    setPlayingClipId(null);
    setPlayUntilTime(null);
    setPlayingSequenceIndex(0);
    playerRef.current?.seek(sortedClips[0].startTime);
    setCurrentTime(sortedClips[0].startTime);
    playerRef.current?.play();
  }, [sortedClips]);

  const handleMarkIn = useCallback(
    (timeSeconds: number) => {
      if (selectedClipId) {
        setClips((prev) =>
          prev.map((c) => {
            if (c.id !== selectedClipId) return c;
            if (timeSeconds >= c.endTime) return c;
            return { ...c, startTime: timeSeconds };
          })
        );
        return;
      }
      setMarkInTime(timeSeconds);
    },
    [selectedClipId]
  );

  const handleMarkOut = useCallback(
    (timeSeconds: number) => {
      if (selectedClipId) {
        setClips((prev) =>
          prev.map((c) => {
            if (c.id !== selectedClipId) return c;
            if (timeSeconds <= c.startTime) return c;
            return { ...c, endTime: timeSeconds };
          })
        );
        return;
      }
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
    [selectedClipId, markInTime, clips.length]
  );

  const handleRemoveClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleResizeClip = useCallback(
    (id: string, newStartTime?: number, newEndTime?: number) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const start = newStartTime ?? c.startTime;
          const end = newEndTime ?? c.endTime;
          if (end <= start) return c;
          return { ...c, startTime: start, endTime: end };
        })
      );
    },
    []
  );

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
        {/* Left column: Player, Timeline, Clipping (only Clipping scrolls vertically) */}
        <div className="flex min-w-0 flex-1 flex-col min-h-0 gap-4 overflow-hidden p-4">
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
                isPlaying={isPlaying}
                onTransportPlay={handlePlay}
                onTransportPause={handlePause}
                onTransportStop={handleStop}
                currentTimeSeconds={currentTime}
                markInTime={markInTime}
                selectedClip={selectedClipId ? clips.find((c) => c.id === selectedClipId) ?? null : null}
                onMarkIn={handleMarkIn}
                onMarkOut={handleMarkOut}
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
              onTrackClick={(time) => {
                handleSeek(time);
                setSelectedClipId(null);
              }}
              clips={clips}
              selectedClipId={selectedClipId}
              onSelectClip={setSelectedClipId}
              onRemoveClip={handleRemoveClip}
              onResizeClip={handleResizeClip}
            />
          </section>

          {/* 3. Clipping: title fixed, only the list of rows scrolls. */}
          <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-secondary bg-secondary p-3">
            <div className="flex shrink-0 items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary">
                Clipping
              </h3>
              <button
                type="button"
                onClick={handlePlayFullSequence}
                disabled={clips.length === 0}
                title="Play full sequence (order 1 to N)"
                aria-label="Play full sequence"
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-secondary bg-primary text-fg-secondary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
              >
                <Play className="size-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <EditorClipsList
              clips={clips}
              clipUrl={clipState.clipUrl}
              channelId={channelId}
              selectedClipId={selectedClipId}
              onSelectClip={setSelectedClipId}
              playingClipId={playingClipId}
              isPlaying={isPlaying}
              onPlaySubclip={handlePlaySubclip}
              onPause={handlePause}
              onOrderChange={handleOrderChange}
              onRemove={handleRemoveClip}
              onSeek={handleSeek}
              />
            </div>
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
