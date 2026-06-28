import type { TenantDto } from "@/services/tenant-bff.service";
import {
  DEFAULT_EDITOR_SUBTITLE_SETTINGS,
  normalizeEditorSubtitleSettings,
  type EditorSubtitleSettings,
} from "@/types/editor";

/** When false, hide transcript/news button on completed VOD encode rows. */
export function tenantSubtitlesTranscriptNewsUiEnabled(tenant: TenantDto | null | undefined): boolean {
  return tenantNewsButtonEnabled(tenant);
}

export const DEFAULT_TENANT_AVAILABLE_LANGUAGES = ["en", "es", "he"] as const;

/** Normalize tenant language pool from API. */
export function tenantAvailableLanguages(tenant: TenantDto | null | undefined): string[] {
  const raw = tenant?.availableLanguages;
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_TENANT_AVAILABLE_LANGUAGES];
  const out: string[] = [];
  for (const item of raw) {
    const code = String(item || "")
      .trim()
      .toLowerCase();
    if (!code || code === "auto") continue;
    if (!out.includes(code)) out.push(code);
  }
  return out.length ? out : [...DEFAULT_TENANT_AVAILABLE_LANGUAGES];
}

/** All tenant pool languages ON — default for new clips. */
export function buildDefaultSubtitleLocales(tenant: TenantDto | null | undefined): Record<string, boolean> {
  const langs = tenantAvailableLanguages(tenant);
  return Object.fromEntries(langs.map((code) => [code, true]));
}

/** News locale toggles default from tenant News tab. */
export function buildDefaultNewsLocales(tenant: TenantDto | null | undefined): Record<string, boolean> {
  const langs = tenantAvailableLanguages(tenant);
  const on = tenant?.newsDefaultGenerate !== false;
  return Object.fromEntries(langs.map((code) => [code, on]));
}

/** Effective news button visibility (requires subtitles master switch). */
export function tenantNewsButtonEnabled(tenant: TenantDto | null | undefined): boolean {
  if (!tenant || tenant.subtitlesEnabled === false) return false;
  if (tenant.newsButtonEnabled === false) return false;
  return tenant.subtitlesTranscriptNewsUiEnabled !== false;
}

/** Default burn-in language from tenant admin (must be in pool). */
export function tenantDefaultBurnInLanguage(tenant: TenantDto | null | undefined): string {
  const langs = tenantAvailableLanguages(tenant);
  const raw = String(tenant?.subtitlesDefaultBurnInLanguage || "")
    .trim()
    .toLowerCase();
  if (raw && langs.includes(raw)) return raw;
  return langs[0] ?? "en";
}

/** Default subtitle modal options for new clips (tenant admin overrides). */
export function buildTenantDefaultSubtitleSettings(
  tenant: TenantDto | null | undefined,
): EditorSubtitleSettings & {
  transcribeSpeakerDiarization: boolean;
  transcribeInferSpeakerNames: boolean;
  burnInLanguage: string;
} {
  const burnLang = tenantDefaultBurnInLanguage(tenant);
  const normalized = normalizeEditorSubtitleSettings({
    ...DEFAULT_EDITOR_SUBTITLE_SETTINGS,
    burnInLanguage: burnLang,
    transcribeSpeakerDiarization: tenant?.subtitlesDefaultDiarization !== false,
    transcribeInferSpeakerNames: tenant?.subtitlesDefaultInferSpeakerNames === true,
  });
  return {
    ...normalized,
    burnInLanguage: burnLang,
  };
}

/** Merge clip subtitleLocales with tenant pool (add new langs as true). */
export function mergeSubtitleLocalesWithTenantPool(
  existing: Record<string, boolean> | undefined,
  tenant: TenantDto | null | undefined,
): Record<string, boolean> {
  const pool = tenantAvailableLanguages(tenant);
  const base = buildDefaultSubtitleLocales(tenant);
  const prev = existing && typeof existing === "object" ? existing : {};
  const out: Record<string, boolean> = {};
  for (const code of pool) {
    out[code] = prev[code] !== undefined ? prev[code] === true : base[code] === true;
  }
  return out;
}

/** Selected language codes for VTT generation. */
export function selectedSubtitleLanguageCodes(locales: Record<string, boolean> | undefined): string[] {
  if (!locales || typeof locales !== "object") return [];
  return Object.entries(locales)
    .filter(([, on]) => on === true)
    .map(([code]) => code);
}
