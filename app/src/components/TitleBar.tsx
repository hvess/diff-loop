import type { ReactNode } from "react";
import { isMac } from "../platform";

/** The 52px bar under the window's own controls; drags the window on macOS, where it is the title bar. */
export function TitleBar({ children }: { children?: ReactNode }) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-[52px] flex-none items-center justify-between border-b border-border pr-4"
      style={{ paddingLeft: isMac ? 84 : 16 }}
    >
      {children}
    </div>
  );
}
