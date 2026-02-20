import axios from "axios";
import type { Channel } from "@/types/channel";

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    accountId: params.get("accountId") || "",
    tenantId: params.get("tenantId") || "",
  };
}

export async function getChannels(): Promise<Channel[]> {
  const { accountId, tenantId } = getQueryParams();

  const response = await axios.get<Channel[]>("/api/channels", {
    params: { accountId, tenantId },
  });

  return response.data;
}
