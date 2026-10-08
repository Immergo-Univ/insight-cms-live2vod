import type { EditorDubbingConfig, EditorSubClip } from "@/types/editor";
import type { TenantDto } from "@/services/tenant-bff.service";
import {
  selectedDubbingLanguageCodes,
  tenantAvailableDubbingLanguages,
} from "@/utils/tenant-dubbing-defaults";
import {
  clipDubbingEnabled,
  resolveClipDubbingSourceLanguage,
} from "@/utils/editor-subclip-dubbing";

export function dubbingConfigFromClip(clip: EditorSubClip): EditorDubbingConfig | null {
  if (!clipDubbingEnabled(clip)) return null;
  const selected = selectedDubbingLanguageCodes(clip.dubbingLocales);
  if (selected.length === 0) return null;
  const locales: Record<string, boolean> = {};
  for (const code of selected) locales[code] = true;
  return {
    enabled: true,
    sourceLanguage: resolveClipDubbingSourceLanguage(clip),
    targetLocales: clip.dubbingLocales ?? locales,
    preserveOriginalAudio: true,
    provider: "inworld",
    timeFit: true,
  };
}

export function dubbingLanguagesFromClip(clip: EditorSubClip): string[] {
  return selectedDubbingLanguageCodes(clip.dubbingLocales);
}

export function dubbingRootFromClip(
  clip: EditorSubClip,
  tenant: TenantDto | null | undefined,
): {
  availableDubbingLanguages: string[];
  dubbingLanguages: string[];
} {
  return {
    availableDubbingLanguages: tenantAvailableDubbingLanguages(tenant),
    dubbingLanguages: dubbingLanguagesFromClip(clip),
  };
}
