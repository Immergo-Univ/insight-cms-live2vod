import { httpClient } from "./http-client";
import type { Channel } from "@/types/channel";

export async function getChannels(): Promise<Channel[]> {
  const tenantId = httpClient.getTenantId();
  const bffClient = httpClient.getBffClient();

  const response = await bffClient.get<Channel[]>("/channels", {
    params: { tenantId },
  });

  return response.data;
}
