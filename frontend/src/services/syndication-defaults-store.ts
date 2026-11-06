import type { SyndicationPlatform } from "@/components/syndication/syndication-settings-model";

/**
 * Local persistence for per-account syndication default settings.
 *
 * The backend does not yet expose endpoints to store tenant-level posting
 * defaults (only per-clip syndication config and account connections exist).
 * Until those endpoints land (see docs/syndication_new_design.md), drafts are
 * kept in localStorage so the new Social Media view is fully usable for review.
 * Swap these functions for real API calls once the backend is available.
 */

const STORE_PREFIX = "l2v-syndication-defaults-v1";

function storeKey(tenantId: string, platform: SyndicationPlatform, accountId: string): string {
  return `${STORE_PREFIX}:${tenantId}:${platform}:${accountId}`;
}

export function loadAccountDefaults(
  tenantId: string,
  platform: SyndicationPlatform,
  accountId: string,
): Record<string, unknown> | null {
  if (!tenantId || !accountId) return null;
  try {
    const raw = localStorage.getItem(storeKey(tenantId, platform, accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function saveAccountDefaults(
  tenantId: string,
  platform: SyndicationPlatform,
  accountId: string,
  values: Record<string, unknown>,
): void {
  if (!tenantId || !accountId) return;
  try {
    localStorage.setItem(storeKey(tenantId, platform, accountId), JSON.stringify(values));
  } catch {
    /* ignore quota / serialization errors */
  }
}
