import { isMac } from "../platform";

/**
 * An empty strip over the window's top that drags it on macOS, where the window has no title bar of its own and its
 * controls sit over the content; elsewhere the system's title bar drags it, and this draws nothing.
 */
export function TitleBar({ className = "" }: { className?: string }) {
  if (!isMac) return null;
  // Must stay empty: a bare `data-tauri-drag-region` drags only on a press aimed at the element itself.
  return <div data-tauri-drag-region aria-hidden className={`absolute top-0 left-0 z-10 h-[52px] ${className}`} />;
}
