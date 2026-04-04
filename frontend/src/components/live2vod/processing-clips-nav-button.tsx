import { useLocation, useNavigate } from "react-router";
import { VideoRecorder } from "@untitledui/icons";
import { useVodProcessingOptional } from "@/providers/vod-processing-provider";

/**
 * Floating nav control (same footprint as JSON button): opens Processing Clips with badge for active jobs.
 */
export function ProcessingClipsNavButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const vod = useVodProcessingOptional();
  const activeCount = vod?.activeCount ?? 0;
  const tenantMissing = !vod?.tenantId;

  const go = () => {
    navigate({ pathname: "/processing-clips", search: location.search });
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={go}
        className="relative flex size-10 cursor-pointer items-center justify-center rounded-full border border-secondary bg-primary shadow-lg transition-colors hover:bg-secondary"
        title={tenantMissing ? "Set tenantId in URL to track jobs" : "Processing Clips"}
        aria-label="Open Processing Clips"
      >
        <VideoRecorder className="size-4.5 text-fg-quaternary" aria-hidden />
        {activeCount > 0 ? (
          <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-brand-solid px-1 py-0.5 text-[10px] font-bold leading-none text-white">
            {activeCount > 99 ? "99+" : activeCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
