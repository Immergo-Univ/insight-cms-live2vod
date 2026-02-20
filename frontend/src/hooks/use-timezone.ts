import { useMemo } from "react";
import { getLocalTimeZone } from "@internationalized/date";

/**
 * Reads ?tz= from URL (IANA format, e.g. "America/Argentina/Buenos_Aires").
 * Falls back to the browser's local timezone when not provided.
 */
export function useTimezone(): string {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tz") || getLocalTimeZone();
  }, []);
}
