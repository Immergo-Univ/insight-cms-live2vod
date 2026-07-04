import { httpClient } from "./http-client";

export interface ClearAdsSnapshotResponse {
  ok: boolean;
  localRemoved: boolean;
  s3: { skipped: true } | { deleted: boolean };
}

/**
 * Remove all ad detection records (precalculated ads + live probe fields) for a channel.
 * Logo template management was removed; ad windows now come from the AD recognition scheduler.
 */
export async function deleteChannelAdsSnapshot(channelId: string): Promise<ClearAdsSnapshotResponse> {
  const client = httpClient.getBffClient();
  const { data } = await client.delete<ClearAdsSnapshotResponse>(
    `/channels/${encodeURIComponent(channelId)}/settings/ads-snapshot`,
  );
  return data;
}
