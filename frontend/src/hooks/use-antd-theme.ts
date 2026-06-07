import { useEffect, useState } from "react";
import { theme } from "antd";

/** Sync Ant Design theme algorithm with the app `dark-mode` class on `<html>`. */
export function useAntdThemeAlgorithm() {
  const [antdDark, setAntdDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setAntdDark(el.classList.contains("dark-mode"));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  return antdDark ? theme.darkAlgorithm : theme.defaultAlgorithm;
}
