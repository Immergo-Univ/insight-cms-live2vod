import { httpClient } from "./http-client";
import type { MainCategory } from "@/types/main-category";

export async function getMainCategories(): Promise<MainCategory[]> {
  const tenantId = httpClient.getTenantId();
  const bffClient = httpClient.getBffClient();

  const response = await bffClient.get<MainCategory[]>("/main-categories", {
    params: { tenantId },
  });

  return response.data;
}
