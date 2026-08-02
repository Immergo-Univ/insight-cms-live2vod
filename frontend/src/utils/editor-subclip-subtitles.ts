import {
  normalizeEditorSubtitleSettings,
  type EditorSubClip,
  type EditorSubClipEncodeOptions,
} from "@/types/editor";
import type { TenantDto } from "@/services/tenant-bff.service";
import {
  buildDefaultSubtitleLocales,
  selectedSubtitleLanguageCodes,
  tenantAvailableLanguages,
} from "@/utils/tenant-subtitle-defaults";

/** VTT/STT generation active (legacy subtitleMode supported). */
export function clipSubtitleGenerateEnabled(c: EditorSubClipEncodeOptions | undefined): boolean {
  if (!c) return false;
  if (c.subtitleGenerateEnabled != null) return c.subtitleGenerateEnabled === true;
  return c.subtitleMode === true;
}

export function clipHasSelectedSubtitleLocales(c: EditorSubClipEncodeOptions | undefined): boolean {
  return selectedSubtitleLanguageCodes(c?.subtitleLocales).length > 0;
}

/**
 * Transcript + news package for encode (modal master toggle).
 * Legacy: news locales explicitly on + VTT ready.
 */
export function clipTranscriptNewsGenerateEnabled(c: EditorSubClipEncodeOptions | undefined): boolean {
  if (!c) return false;
  if (c.transcriptNewsGenerateEnabled != null) return c.transcriptNewsGenerateEnabled === true;
  if (!clipSubtitleGenerateEnabled(c) || !clipHasSelectedSubtitleLocales(c)) return false;
  const locales = c.newsLocales;
  if (!locales || typeof locales !== "object") return false;
  return Object.values(locales).some((v) => v === true);
}

/** When locales change, keep burn language valid or clear burn. */
export function reconcileBurnInAfterLocaleChange(
  clip: EditorSubClip,
  nextLocales: Record<string, boolean>,
): Pick<EditorSubClip, "subtitleLocales" | "burnInEnabled" | "subtitleSettings"> {
  const selected = selectedSubtitleLanguageCodes(nextLocales);
  const burnLang = resolveClipBurnInLanguage({ ...clip, subtitleLocales: nextLocales });
  const st = normalizeEditorSubtitleSettings(clip.subtitleSettings);
  let burnInEnabled = clip.burnInEnabled;
  if (burnInEnabled == null) burnInEnabled = st.burnIn === true;
  if (selected.length === 0) burnInEnabled = false;
  const burnInLanguage = selected.includes(burnLang) ? burnLang : (selected[0] ?? st.burnInLanguage ?? "en");
  return {
    subtitleLocales: nextLocales,
    burnInEnabled: selected.length > 0 ? burnInEnabled : false,
    subtitleSettings: { ...st, burnInLanguage },
  };
}

/** Enable transcript/news and force VTT generation for every tenant language. */
export function applyTranscriptNewsGenerateOn(
  clip: EditorSubClip,
  tenant: TenantDto | null | undefined,
  defaultSubtitleSettings?: EditorSubClip["subtitleSettings"],
): Pick<
  EditorSubClip,
  | "transcriptNewsGenerateEnabled"
  | "subtitleGenerateEnabled"
  | "subtitleMode"
  | "subtitleLocales"
  | "newsLocales"
  | "burnInEnabled"
  | "subtitleSettings"
> {
  const subtitleLocales = buildDefaultSubtitleLocales(tenant);
  const langs = tenantAvailableLanguages(tenant);
  const newsLocales = Object.fromEntries(langs.map((code) => [code, true]));
  const merged = reconcileBurnInAfterLocaleChange(
    { ...clip, subtitleLocales },
    subtitleLocales,
  );
  const st =
    clip.subtitleSettings ??
    defaultSubtitleSettings ??
    normalizeEditorSubtitleSettings(undefined);
  return {
    transcriptNewsGenerateEnabled: true,
    subtitleGenerateEnabled: true,
    subtitleMode: true,
    subtitleLocales: merged.subtitleLocales,
    newsLocales,
    burnInEnabled: merged.burnInEnabled,
    subtitleSettings: merged.subtitleSettings ?? st,
  };
}

/** Disable transcript/news drafts (keeps VTT settings unchanged). */
export function applyTranscriptNewsGenerateOff(
  tenant: TenantDto | null | undefined,
): Pick<EditorSubClip, "transcriptNewsGenerateEnabled" | "newsLocales"> {
  const langs = tenantAvailableLanguages(tenant);
  return {
    transcriptNewsGenerateEnabled: false,
    newsLocales: Object.fromEntries(langs.map((code) => [code, false])),
  };
}

/** Burn-in active only when generation is on and at least one locale selected. */
export function clipBurnInEnabled(c: EditorSubClipEncodeOptions | undefined): boolean {
  if (!clipSubtitleGenerateEnabled(c)) return false;
  const selected = selectedSubtitleLanguageCodes(c?.subtitleLocales);
  if (selected.length === 0) return false;
  if (c?.burnInEnabled != null) return c.burnInEnabled === true;
  return normalizeEditorSubtitleSettings(c?.subtitleSettings).burnIn === true;
}

/** Resolve burn-in language; must be among selected locales. */
export function resolveClipBurnInLanguage(c: EditorSubClip): string {
  const selected = selectedSubtitleLanguageCodes(c.subtitleLocales);
  const st = normalizeEditorSubtitleSettings(c.subtitleSettings);
  const fromSettings = (st.burnInLanguage || "").trim().toLowerCase();
  if (fromSettings && selected.includes(fromSettings)) return fromSettings;
  return selected[0] ?? "en";
}
