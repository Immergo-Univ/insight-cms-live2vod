import { useEffect, useState } from "react";

interface LogoDetectorFramePreviewProps {
  channelId: string;
  /** When false, polling stops (e.g. another tab is visible). */
  active: boolean;
}

/**
 * Last logo-detector debug JPEG for this channel (1 Hz cache-bust when active).
 */
export function LogoDetectorFramePreview({ channelId, active }: LogoDetectorFramePreviewProps) {
  const [burst, setBurst] = useState(() => Date.now());
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!active) return;
    setLoadError(false);
    setBurst(Date.now());
    const id = window.setInterval(() => setBurst(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const src = `/api/channels/${encodeURIComponent(channelId)}/logo-detector-debug?_=${burst}`;

  if (!active) return null;

  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3">
      {loadError ? (
        <p className="text-center text-sm text-tertiary">
          No debug frame yet. It appears after the logo-detector runs on this channel (live matching or archive
          scan).
        </p>
      ) : (
        <img
          src={src}
          alt="Last logo-detector frame"
          className="max-h-[min(70vh,720px)] w-auto max-w-full rounded-lg border border-secondary object-contain shadow-sm"
          onLoad={() => setLoadError(false)}
          onError={() => setLoadError(true)}
        />
      )}
    </div>
  );
}
