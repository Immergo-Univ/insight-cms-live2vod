import { httpClient } from "./http-client";

export interface DetectedAd {
  startOffsetSec: number;
  endOffsetSec: number;
  startOffsetHms: string;
  endOffsetHms: string;
  startProgramDateTime: string;
  endProgramDateTime: string;
}

export interface AdsDetectionResult {
  m3u8: string;
  totalDurationSec: number;
  process: { elapsedMs: number; elapsedSec: number };
  ads: DetectedAd[];
}

export interface PreCalcAd {
  startEpoch: number;
  endEpoch: number;
  startProgramDateTime: string;
  endProgramDateTime: string;
}

export interface PreCalcAdsResult {
  ads: PreCalcAd[];
  processedRange: {
    earliest: string;
    latest: string;
  } | null;
}

export async function detectAds(
  m3u8Url: string,
  corner = "br",
): Promise<AdsDetectionResult> {
  const bffClient = httpClient.getBffClient();
  const response = await bffClient.post<AdsDetectionResult>("/ads/detect", {
    m3u8Url,
    corner,
  });
  return response.data;
}

export async function getPrecalculatedAds(
  hlsStream: string,
  startTime: number,
  endTime: number,
): Promise<PreCalcAdsResult> {
  const bffClient = httpClient.getBffClient();
  const response = await bffClient.get<PreCalcAdsResult>("/ads/precalculated", {
    params: { hlsStream, startTime, endTime },
  });
  return response.data;
}
