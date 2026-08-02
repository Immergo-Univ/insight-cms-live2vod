import {
  normalizeEditorSubtitleSettings,
  type EditorSubClip,
  type EditorSubtitlesConfig,
} from "@/types/editor";
import type { TenantDto } from "@/services/tenant-bff.service";
import {
  selectedSubtitleLanguageCodes,
  tenantAvailableLanguages,
} from "@/utils/tenant-subtitle-defaults";
import {
  clipBurnInEnabled,
  clipSubtitleGenerateEnabled,
  clipTranscriptNewsGenerateEnabled,
  resolveClipBurnInLanguage,
} from "@/utils/editor-subclip-subtitles";

export function subtitlesConfigFromClip(clip: EditorSubClip): EditorSubtitlesConfig | null {
  if (!clipSubtitleGenerateEnabled(clip)) return null;
  const selected = selectedSubtitleLanguageCodes(clip.subtitleLocales);
  if (selected.length === 0) return null;
  const st = normalizeEditorSubtitleSettings(clip.subtitleSettings);
  const locales: Record<string, boolean> = {};
  for (const code of selected) locales[code] = true;
  const block: EditorSubtitlesConfig = {
    enabled: true,
    subtitleLocales: clip.subtitleLocales ?? locales,
    whisperSourceLanguage: st.whisperSourceLanguage,
    style: { ...st.style },
    transcribeSpeakerDiarization: st.transcribeSpeakerDiarization,
    transcribeInferSpeakerNames: st.transcribeInferSpeakerNames,
  };
  if (clipBurnInEnabled(clip)) {
    block.burnIn = true;
    block.burnInLanguage = resolveClipBurnInLanguage(clip);
  }
  return block;
}

export function subtitleLanguagesFromClip(clip: EditorSubClip): string[] {
  return selectedSubtitleLanguageCodes(clip.subtitleLocales);
}

/**
 * Effective per-language news toggles for a clip, over the tenant language pool.
 *
 * Semantics MUST match the editor "News languages at encode" checkbox
 * (`clip.newsLocales?.[code] !== false`): a language is ON unless explicitly disabled.
 * Using the raw object with `Object.values(...).some(Boolean)` was wrong when
 * `clip.newsLocales` was empty/partial (stale draft, or the tenant pool changed), which
 * made the UI show news ON while the encode spec sent `transcribeGenerateNews: false`.
 */
export function newsLocalesFromClip(
  clip: EditorSubClip,
  tenant: TenantDto | null | undefined,
): Record<string, boolean> {
  const pool = tenantAvailableLanguages(tenant);
  const prev =
    clip.newsLocales && typeof clip.newsLocales === "object" ? clip.newsLocales : {};
  const wantTn = clipTranscriptNewsGenerateEnabled(clip);
  const out: Record<string, boolean> = {};
  for (const code of pool) {
    // Master toggle off → no news locales. When on, ON unless explicitly disabled.
    out[code] = wantTn ? prev[code] !== false : false;
  }
  return out;
}

export function transcribeRootFromClip(
  clip: EditorSubClip,
  tenant: TenantDto | null | undefined,
): {
  availableLanguages: string[];
  subtitleLanguages: string[];
  transcribeSpeakerDiarization?: boolean;
  transcribeGenerateNews?: boolean;
  transcribeNewsLocales?: Record<string, boolean>;
  transcribeInferSpeakerNames?: boolean;
} {
  const availableLanguages = tenantAvailableLanguages(tenant);
  const subtitleLanguages = subtitleLanguagesFromClip(clip);
  const gen = clipSubtitleGenerateEnabled(clip) && subtitleLanguages.length > 0;
  const st = normalizeEditorSubtitleSettings(clip.subtitleSettings);
  const newsLocales = newsLocalesFromClip(clip, tenant);
  const anyNews = Object.values(newsLocales).some(Boolean);
  const wantTn = clipTranscriptNewsGenerateEnabled(clip);
  return {
    availableLanguages,
    subtitleLanguages,
    ...(gen
      ? {
          transcribeSpeakerDiarization: st.transcribeSpeakerDiarization,
          // Transcript + news require VTT ready (at least one language) and the master toggle.
          transcribeGenerateNews: gen && wantTn && anyNews,
          transcribeNewsLocales: newsLocales,
          transcribeInferSpeakerNames: st.transcribeInferSpeakerNames,
        }
      : {}),
  };
}
