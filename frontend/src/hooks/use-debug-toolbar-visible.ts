import { useEffect, useState } from "react";
import {
  isDebugToolbarVisible,
  subscribeDebugToolbar,
} from "@/utils/debug-toolbar";

/** True after DebugON() is called from the browser console. */
export function useDebugToolbarVisible(): boolean {
  const [visible, setVisible] = useState(isDebugToolbarVisible);

  useEffect(() => subscribeDebugToolbar(() => setVisible(isDebugToolbarVisible())), []);

  return visible;
}
