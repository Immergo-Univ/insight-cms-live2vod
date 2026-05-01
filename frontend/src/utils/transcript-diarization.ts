import type { TranscriptDiarizationPayload } from "@/types/vod-job";

/** Default display name for a diarization speaker id (matches backend). */
export function defaultSpeakerDisplayName(speakerId: string): string {
  const x = speakerId.trim();
  if (/^[A-Z]$/.test(x)) return `Speaker ${x}`;
  return x || "Speaker";
}

/** Rebuild dash-prefixed transcript lines from segments + label map (matches backend). */
export function rebuildTranscriptPreviewText(di: TranscriptDiarizationPayload): string {
  const labels = di.speakerLabels && typeof di.speakerLabels === "object" ? di.speakerLabels : {};
  return di.segments
    .map((s) => {
      const id = String(s.speaker || "").trim() || "A";
      const custom = typeof labels[id] === "string" ? labels[id].trim() : "";
      const name = custom || defaultSpeakerDisplayName(id);
      const line = String(s.text || "")
        .trim()
        .replace(/\s*\n\s*/g, " ");
      return `- ${name}: ${line}`;
    })
    .join("\n\n");
}

export function collectUniqueSpeakerIds(di: TranscriptDiarizationPayload): string[] {
  const set = new Set<string>();
  for (const s of di.segments) {
    const id = String(s.speaker || "").trim() || "A";
    set.add(id);
  }
  return [...set].sort();
}
