import type { EditorStateJson } from "@/types/editor";

declare global {
  interface Window {
    /**
     * Live2VOD editor: returns a deep clone of the current encode/export JSON snapshot, or null if not ready.
     */
    getStatusJson?: () => EditorStateJson | null;
  }
}

export {};
