import {
  normalizeEditorSubtitleSettings,
  type EditorSubClip,
  type EditorSubClipEncodeOptions,
} from "@/types/editor";
import { selectedSubtitleLanguageCodes } from "@/utils/tenant-subtitle-defaults";

/** VTT/STT generation active (legacy subtitleMode supported). */
export function clipSubtitleGenerateEnabled(c: EditorSubClipEncodeOptions | undefined): boolean {
  if (!c) return false;
  if (c.subtitleGenerateEnabled != null) return c.subtitleGenerateEnabled === true;
  return c.subtitleMode === true;
}

/** Burn-in active only when generation is on and at least one locale selected. */
export function clipBurnInEnabled(c: EditorSubClipEncodeOptions | undefined): boolean {
  if (!clipSubtitleGenerateEnabled(c)) return false;
  const selected = selectedSubtitleLanguageCodes(c?.subtitleLocales);
  if (selected.length === 0) return false;
  if (c?.burnInEnabled != null) return c.burnInEnabled === true;
  return normalizeEditorSubtitleSettings(c?.subtitleSettings).burnIn === true;
}

export function clipHasSelectedSubtitleLocales(c: EditorSubClipEncodeOptions | undefined): boolean {
  return selectedSubtitleLanguageCodes(c?.subtitleLocales).length > 0;
}

/** Resolve burn-in language; must be among selected locales. */
export function resolveClipBurnInLanguage(c: EditorSubClip): string {
  const selected = selectedSubtitleLanguageCodes(c.subtitleLocales);
  const st = normalizeEditorSubtitleSettings(c.subtitleSettings);
  const fromSettings = (st.burnInLanguage || "").trim().toLowerCase();
  if (fromSettings && selected.includes(fromSettings)) return fromSettings;
  return selected[0] ?? "en";
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
