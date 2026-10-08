import type { TenantDto } from "@/services/tenant-bff.service";
import type { WhisperLanguageCode } from "@/types/editor-whisper-languages";
import { tenantAvailableLanguages } from "@/utils/tenant-subtitle-defaults";

/** When false, hide AI dubbing controls in the editor. */
export function tenantDubbingEnabled(tenant: TenantDto | null | undefined): boolean {
  return tenant?.dubbingEnabled === true;
}

/** Normalize tenant dubbing language pool from API (falls back to subtitle pool). */
export function tenantAvailableDubbingLanguages(tenant: TenantDto | null | undefined): string[] {
  const raw = tenant?.availableDubbingLanguages;
  if (!Array.isArray(raw) || raw.length === 0) return tenantAvailableLanguages(tenant);
  const out: string[] = [];
  for (const item of raw) {
    const code = String(item || "")
      .trim()
      .toLowerCase();
    if (!code || code === "auto") continue;
    if (!out.includes(code)) out.push(code);
  }
  return out.length ? out : tenantAvailableLanguages(tenant);
}

/** All tenant dubbing pool languages ON — default when dubbingDefaultEnabled. */
export function buildDefaultDubbingLocales(tenant: TenantDto | null | undefined): Record<string, boolean> {
  const langs = tenantAvailableDubbingLanguages(tenant);
  const on = tenant?.dubbingDefaultEnabled === true;
  return Object.fromEntries(langs.map((code) => [code, on]));
}

/** Merge clip dubbingLocales with tenant pool. */
export function mergeDubbingLocalesWithTenantPool(
  existing: Record<string, boolean> | undefined,
  tenant: TenantDto | null | undefined,
): Record<string, boolean> {
  const pool = tenantAvailableDubbingLanguages(tenant);
  const base = buildDefaultDubbingLocales(tenant);
  const prev = existing && typeof existing === "object" ? existing : {};
  const out: Record<string, boolean> = {};
  for (const code of pool) {
    out[code] = prev[code] !== undefined ? prev[code] === true : base[code] === true;
  }
  return out;
}

/** Selected language codes for dubbing targets. */
export function selectedDubbingLanguageCodes(locales: Record<string, boolean> | undefined): string[] {
  if (!locales || typeof locales !== "object") return [];
  return Object.entries(locales)
    .filter(([, on]) => on === true)
    .map(([code]) => code);
}

export function defaultDubbingSourceLanguage(
  tenant: TenantDto | null | undefined,
): WhisperLanguageCode {
  void tenant;
  return "auto";
}
