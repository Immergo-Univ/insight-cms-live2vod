import { httpClient } from "./http-client";
import type { Channel } from "@/types/channel";

export async function getChannels(): Promise<Channel[]> {
  const accountId = httpClient.getAccountId();
  const tenantId = httpClient.getTenantId();
  const bffClient = httpClient.getBffClient();

  const response = await bffClient.get<Channel[]>("/channels", {
    params: { accountId, tenantId },
  });

  return response.data;
}
