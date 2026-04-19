import type { EditorStateJson } from "@/types/editor";

/** Monospace-friendly ASCII (no CoreUI / no Unicode box blocks). */
const IMMERGO_ASCII = String.raw`
  _____ __  __ _____ _____   ____  ___  
 |_   _|  \/  | ____| ____| |___ \/ _ \ 
   | | | |\/| |  _| |  _|     __) | | | |
   | | | |  | | |___| |___   / __/| |_| |
   |_| |_|  |_|_____|_____| |_____|\___/ 
`.trim();

/**
 * Exposes getStatusJson() on window and prints IMMERGO when DevTools is likely opened (heuristic).
 *
 * @param getJson Latest editor export snapshot (same shape as encode spec root).
 * @returns cleanup (remove globals + stop polling)
 */
export function installEditorConsoleTools(getJson: () => EditorStateJson | null): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const getStatusJson = (): EditorStateJson | null => {
    const j = getJson();
    return j == null ? null : structuredClone(j);
  };

  window.getStatusJson = getStatusJson;

  let lastDevtoolsLikelyOpen = false;
  const thresholdPx = 120;

  const tick = () => {
    const widthGap = window.outerWidth - window.innerWidth;
    const heightGap = window.outerHeight - window.innerHeight;
    const likelyOpen = widthGap > thresholdPx || heightGap > thresholdPx;
    if (likelyOpen && !lastDevtoolsLikelyOpen) {
      // eslint-disable-next-line no-console -- intentional dev banner
      console.log(IMMERGO_ASCII);
      // eslint-disable-next-line no-console -- intentional dev banner
      console.log("Tip: run getStatusJson() for the current editor export JSON.");
    }
    lastDevtoolsLikelyOpen = likelyOpen;
  };

  const pollId = window.setInterval(tick, 400);

  return () => {
    if (window.getStatusJson === getStatusJson) {
      delete window.getStatusJson;
    }
    window.clearInterval(pollId);
    lastDevtoolsLikelyOpen = false;
  };
}
