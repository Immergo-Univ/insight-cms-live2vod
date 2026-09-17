import type { EditorStateJson, EncodedOutputAsset } from "@/types/editor";
import type { VodJobRecord } from "@/types/vod-job";

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function isM3u8Url(value: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(value.trim());
}

function pickM3u8FromList(urls: (string | null | undefined)[] | undefined): string | null {
  if (!Array.isArray(urls)) return null;
  for (const entry of urls) {
    const trimmed = typeof entry === "string" ? entry.trim() : "";
    if (trimmed && isHttpUrl(trimmed) && isM3u8Url(trimmed)) return trimmed;
  }
  return null;
}

/** Reconstruct master.m3u8 from fields stamped on editorSpec at dispatch time. */
function masterUrlFromEditorSpec(spec: EditorStateJson | null | undefined): string | null {
  if (!spec || typeof spec !== "object") return null;
  const cdnBase = typeof spec.__cdnBase === "string" ? spec.__cdnBase.trim().replace(/\/+$/, "") : "";
  const folder =
    typeof spec.__customerFolder === "string" ? spec.__customerFolder.trim().replace(/^\/+|\/+$/g, "") : "";
  const guid = typeof spec.__vodGuid === "string" ? spec.__vodGuid.trim() : "";
  if (!cdnBase || !folder || !guid) return null;
  return `${cdnBase}/${folder}/transcoded/${guid}/hls/master.m3u8`;
}

/**
 * Public playback URL for the encoded output preview (prefers HLS master.m3u8).
 */
export function resolveEncodedPlaybackUrl(job: VodJobRecord): string | null {
  const spec = job.editorSpec;

  const masterFromSpec =
    spec && typeof spec.__masterUrl === "string" ? spec.__masterUrl.trim() : "";
  if (masterFromSpec && isHttpUrl(masterFromSpec)) return masterFromSpec;

  const rebuilt = masterUrlFromEditorSpec(spec);
  if (rebuilt) return rebuilt;

  const direct = job.outputUrl?.trim();
  if (direct && isHttpUrl(direct) && isM3u8Url(direct)) return direct;

  const m3u8FromList = pickM3u8FromList(job.outputUrls);
  if (m3u8FromList) return m3u8FromList;

  if (direct && isHttpUrl(direct)) return direct;

  return null;
}

/**
 * Enumerate the encoded output assets for the preview player (one tab per asset).
 * Prefers the explicit `__outputAssets` list stamped by the encoder; falls back to a single
 * asset built from {@link resolveEncodedPlaybackUrl} so pre-existing jobs keep working.
 */
export function resolveEncodedOutputAssets(job: VodJobRecord): EncodedOutputAsset[] {
  const explicit = job.editorSpec?.__outputAssets;
  if (Array.isArray(explicit)) {
    const assets: EncodedOutputAsset[] = [];
    const seen = new Set<string>();
    for (const a of explicit) {
      const url = typeof a?.url === "string" ? a.url.trim() : "";
      if (!url || !isHttpUrl(url) || seen.has(url)) continue;
      seen.add(url);
      assets.push({
        kind: a.kind === "mp4" ? "mp4" : "hls",
        label: typeof a?.label === "string" && a.label.trim() ? a.label.trim() : url,
        url,
      });
    }
    // HLS first (supports audio-language switching), then the MP4 renditions.
    assets.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "hls" ? -1 : 1));
    if (assets.length > 0) return assets;
  }

  const fallback = resolveEncodedPlaybackUrl(job);
  if (fallback) {
    return [{ kind: isM3u8Url(fallback) ? "hls" : "mp4", label: isM3u8Url(fallback) ? "HLS" : "MP4", url: fallback }];
  }
  return [];
}
