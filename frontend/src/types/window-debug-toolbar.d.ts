declare global {
  interface Window {
    /** Show the Live2VOD bottom-right debug toolbar (settings, JSON, processing clips). */
    DebugON?: () => void;
    /** Hide the Live2VOD bottom-right debug toolbar. */
    DebugOFF?: () => void;
  }
}

export {};
