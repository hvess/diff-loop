// The sidebar's width, per viewer, in this webview's localStorage (ADR 0016 §2).

const KEY = "diff-loop.sidebar";

/** The design's width, and what a double-click on the edge goes back to. */
export const DEFAULT_WIDTH = 240;
export const MIN_WIDTH = 200;
export const MAX_WIDTH = 560;

/** `width` held inside the sidebar's bounds. */
export function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

/** The width last kept, or the default; a bad value falls back to the default. */
export function loadWidth(): number {
  try {
    const kept = Number(localStorage.getItem(KEY));
    return Number.isFinite(kept) && kept >= MIN_WIDTH && kept <= MAX_WIDTH ? kept : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function rememberWidth(width: number): void {
  try {
    localStorage.setItem(KEY, String(width));
  } catch {
    // Storage unavailable: the width lives for this session only.
  }
}
