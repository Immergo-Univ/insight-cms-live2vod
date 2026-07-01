/** Bottom-right Live2VOD toolbar (settings, JSON, processing clips). Hidden until DebugON(). */

let visible = false;

/** @type {Set<() => void>} */
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function isDebugToolbarVisible(): boolean {
  return visible;
}

/** @param {() => void} listener */
export function subscribeDebugToolbar(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDebugToolbarVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  notify();
}

/**
 * Expose DebugON() / DebugOFF() on window (call from DevTools console).
 * @returns cleanup
 */
export function installDebugToolbarGlobals(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const DebugON = () => {
    setDebugToolbarVisible(true);
    // eslint-disable-next-line no-console -- intentional dev helper
    console.log("[Live2VOD] Debug toolbar visible. Call DebugOFF() to hide.");
  };

  const DebugOFF = () => {
    setDebugToolbarVisible(false);
    // eslint-disable-next-line no-console -- intentional dev helper
    console.log("[Live2VOD] Debug toolbar hidden.");
  };

  window.DebugON = DebugON;
  window.DebugOFF = DebugOFF;

  return () => {
    if (window.DebugON === DebugON) delete window.DebugON;
    if (window.DebugOFF === DebugOFF) delete window.DebugOFF;
    setDebugToolbarVisible(false);
  };
}
