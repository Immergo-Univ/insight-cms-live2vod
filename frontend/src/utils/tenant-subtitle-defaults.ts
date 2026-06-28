import type { TenantDto } from "@/services/tenant-bff.service";
import {
  DEFAULT_EDITOR_SUBTITLE_SETTINGS,
  normalizeEditorSubtitleSettings,
  type EditorSubtitleSettings,
} from "@/types/editor";

/** When false, hide transcript/news button on completed VOD encode rows. */
export function tenantSubtitlesTranscriptNewsUiEnabled(tenant: TenantDto | null | undefined): boolean {
  if (!tenant) return true;
  return tenant.subtitlesTranscriptNewsUiEnabled !== false;
}

/** Default subtitle modal options for new clips (tenant admin overrides). */
export function buildTenantDefaultSubtitleSettings(
  tenant: TenantDto | null | undefined,
): EditorSubtitleSettings & {
  transcribeSpeakerDiarization: boolean;
  transcribeInferSpeakerNames: boolean;
  transcribeNewsLocales: { en: boolean; es: boolean; he: boolean };
} {
  return normalizeEditorSubtitleSettings({
    ...DEFAULT_EDITOR_SUBTITLE_SETTINGS,
    burnIn: tenant?.subtitlesDefaultBurnIn === true,
    transcribeSpeakerDiarization: tenant?.subtitlesDefaultDiarization !== false,
    transcribeInferSpeakerNames: tenant?.subtitlesDefaultInferSpeakerNames === true,
    transcribeNewsLocales: {
      en: tenant?.subtitlesDefaultNewsEn !== false,
      es: tenant?.subtitlesDefaultNewsEs !== false,
      he: tenant?.subtitlesDefaultNewsHe !== false,
    },
  });
}
