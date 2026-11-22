import { httpClient } from "./http-client";
import type {
  AiCreditsResponse,
  AiRun,
  AiRunServiceKey,
  CreateCreditOrderBody,
  CreditOrder,
  VodAiRunsResponse,
} from "@/types/ai-credits";

/** Tenant balance, credit catalog and recent purchase orders. */
export async function fetchAiCredits(): Promise<AiCreditsResponse> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const { data } = await client.get<AiCreditsResponse>("/ai-credits", { params: { tenantId } });
  return data;
}

/** Create a purchase order; credits are granted only after admin approval. */
export async function createCreditOrder(body: CreateCreditOrderBody): Promise<CreditOrder> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const { data } = await client.post<{ order: CreditOrder }>("/ai-credits/orders", body, { params: { tenantId } });
  return data.order;
}

export async function cancelCreditOrder(orderId: string): Promise<CreditOrder> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const { data } = await client.post<{ order: CreditOrder }>(
    `/ai-credits/orders/${encodeURIComponent(orderId)}/cancel`,
    {},
    { params: { tenantId } },
  );
  return data.order;
}

/** AI runs started on this VOD + language options and per-minute rates. */
export async function fetchVodAiRuns(vodGuid: string): Promise<VodAiRunsResponse> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const { data } = await client.get<VodAiRunsResponse>(`/vod/by-guid/${encodeURIComponent(vodGuid)}/ai-runs`, {
    params: { tenantId },
  });
  return data;
}

export async function startVodAiRun(
  vodGuid: string,
  service: AiRunServiceKey,
  languages: string[],
): Promise<{ jobIds: string[]; estimatedCredits: number; runs: AiRun[] }> {
  const client = httpClient.getBffClient();
  const tenantId = httpClient.getTenantId();
  const { data } = await client.post<{ jobIds: string[]; estimatedCredits: number; runs: AiRun[] }>(
    `/vod/by-guid/${encodeURIComponent(vodGuid)}/ai-runs`,
    { service, languages },
    { params: { tenantId } },
  );
  return data;
}

/** Extract `{ code, error }` from an axios error response. */
export function readApiError(e: unknown): { code: string; message: string } {
  const err = e as { response?: { data?: { error?: string; code?: string } }; message?: string };
  return {
    code: String(err?.response?.data?.code || ""),
    message: String(err?.response?.data?.error || err?.message || ""),
  };
}
