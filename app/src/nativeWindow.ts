// The window around the page: shown once painted, and its background matching the page (ADR 0010 §1).
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Shows the window, created hidden (tauri.conf.json), after the next frame
 * paints, so it never opens blank or white. `run` in src-tauri/src/lib.rs
 * shows it anyway after `SHOW_ANYWAY`.
 */
export function showWhenPainted() {
  // The first frame runs the callback; the second has painted what it drew.
  requestAnimationFrame(() => requestAnimationFrame(() => void getCurrentWindow().show()));
}

/** Keeps the window's background the page's (`--ui-bg`), so resizing reveals no white edge in dark mode. */
export function matchBackground(): () => void {
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--ui-bg").trim();
    if (bg) void getCurrentWindow().setBackgroundColor(bg);
  };
  apply();
  dark.addEventListener("change", apply);
  return () => dark.removeEventListener("change", apply);
}
