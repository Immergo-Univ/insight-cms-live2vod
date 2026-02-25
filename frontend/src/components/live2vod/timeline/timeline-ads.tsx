import { useMemo } from "react";
import type { PreCalcAd } from "@/services/ads.service";
import { PX_PER_MINUTE } from "./timeline-ruler";

interface TimelineAdsProps {
  ads: PreCalcAd[];
  startDate: Date;
  totalMinutes: number;
}

interface PositionedAd {
  topMinutes: number;
  durationMinutes: number;
}

export function TimelineAds({ ads, startDate, totalMinutes }: TimelineAdsProps) {
  const positioned = useMemo(() => {
    const startMs = startDate.getTime();
    const endMs = startMs + totalMinutes * 60_000;

    return ads.reduce<PositionedAd[]>((acc, ad) => {
      const adStartMs = ad.startEpoch * 1000;
      const adEndMs = ad.endEpoch * 1000;

      if (adEndMs <= startMs || adStartMs >= endMs) return acc;

      const clampedStart = Math.max(adStartMs, startMs);
      const clampedEnd = Math.min(adEndMs, endMs);

      const topMinutes = (clampedStart - startMs) / 60_000;
      const durationMinutes = (clampedEnd - clampedStart) / 60_000;

      if (durationMinutes < 0.5) return acc;

      acc.push({ topMinutes, durationMinutes });
      return acc;
    }, []);
  }, [ads, startDate, totalMinutes]);

  if (positioned.length === 0) return null;

  return (
    <>
      {positioned.map((ad, i) => {
        const top = ad.topMinutes * PX_PER_MINUTE;
        const height = Math.max(ad.durationMinutes * PX_PER_MINUTE, 2);

        return (
          <div
            key={i}
            className="absolute left-12 right-0 z-[5] border-l-2 border-l-amber-400/70 bg-amber-200/25 pointer-events-none"
            style={{ top, height }}
            title={`Ad break (~${Math.round(ad.durationMinutes)}min)`}
          >
            <span className="block truncate px-1.5 pt-px text-[9px] leading-tight font-medium text-amber-600/80">
              AD
            </span>
          </div>
        );
      })}
    </>
  );
}
