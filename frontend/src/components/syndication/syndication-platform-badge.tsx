import { SYNDICATION_PLATFORM_META, type SyndicationPlatform } from "./syndication-settings-model";

/**
 * Colored platform badge with the brand glyph, mirroring the HTML mockup
 * (e.g. YouTube ▶ on #e1251b). `size` is the square side in px.
 */
export function PlatformBadge({
  platform,
  size = 24,
  fontSize = 10,
  radius = 6,
}: {
  platform: SyndicationPlatform;
  size?: number;
  fontSize?: number;
  radius?: number;
}) {
  const meta = SYNDICATION_PLATFORM_META[platform];
  return (
    <span
      aria-hidden
      style={{
        minWidth: size,
        height: size,
        padding: "0 4px",
        boxSizing: "border-box",
        borderRadius: radius,
        background: meta.iconBg,
        color: "#ffffff",
        fontSize,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
        flex: "none",
      }}
    >
      {meta.glyph}
    </span>
  );
}
