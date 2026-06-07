import { ConfigProvider, Select } from "antd";
import type { SelectProps } from "antd";
import { useAntdThemeAlgorithm } from "@/hooks/use-antd-theme";
import { cx } from "@/utils/cx";

/** Modal overlay is z-[10000]; keep Ant Design dropdowns above it. */
export const APP_SELECT_POPUP_Z_INDEX = 10050;

export const appSelectPopupProps: Pick<SelectProps, "getPopupContainer" | "styles"> = {
  getPopupContainer: (triggerNode) => triggerNode.parentElement ?? document.body,
  styles: {
    popup: {
      root: { zIndex: APP_SELECT_POPUP_Z_INDEX },
    },
  },
};

export type AppSelectProps = SelectProps & {
  /** Skip ConfigProvider when a parent already provides antd theme (e.g. admin root). */
  skipThemeProvider?: boolean;
};

export function AppSelect({ skipThemeProvider = false, className, style, ...props }: AppSelectProps) {
  const algorithm = useAntdThemeAlgorithm();
  const fullWidth = style?.width == null && !/\bw-(?:auto|max|min|fit)\b/.test(className ?? "");

  const node = (
    <Select
      {...appSelectPopupProps}
      {...props}
      style={style}
      className={cx(fullWidth && "w-full", className)}
    />
  );

  if (skipThemeProvider) return node;

  return <ConfigProvider theme={{ algorithm }}>{node}</ConfigProvider>;
}
