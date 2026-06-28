import {
  normalizeEditorSubtitleSettings,
  type EditorSubClip,
  type EditorSubtitlesConfig,
} from "@/types/editor";
import type { TenantDto } from "@/services/tenant-bff.service";
import {
  buildDefaultNewsLocales,
  selectedSubtitleLanguageCodes,
  tenantAvailableLanguages,
} from "@/utils/tenant-subtitle-defaults";
import {
  clipBurnInEnabled,
  clipSubtitleGenerateEnabled,
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

export function newsLocalesFromClip(
  clip: EditorSubClip,
  tenant: TenantDto | null | undefined,
): Record<string, boolean> {
  if (clip.newsLocales && typeof clip.newsLocales === "object") return { ...clip.newsLocales };
  return buildDefaultNewsLocales(tenant);
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
  return {
    availableLanguages,
    subtitleLanguages,
    ...(gen
      ? {
          transcribeSpeakerDiarization: st.transcribeSpeakerDiarization,
          transcribeGenerateNews: gen && anyNews,
          transcribeNewsLocales: newsLocales,
          transcribeInferSpeakerNames: st.transcribeInferSpeakerNames,
        }
      : {}),
  };
}
