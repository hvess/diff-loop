// Per-platform conventions the UI follows.

export const isMac = navigator.userAgent.includes("Mac");

/** The platform's command modifier, as shown in labels. */
export const modKey = isMac ? "⌘" : "Ctrl+";

/** Whether `e` carries the platform's command modifier. */
export const hasMod = (e: KeyboardEvent | React.KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

/**
 * Whether `e` is a character key, unmodified, outside a text field: one
 * WebKit leaves unhandled. Space is not one; it presses buttons and scrolls.
 */
export function wouldBeep(e: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "target">): boolean {
  return e.key.length === 1 && e.key !== " " && !e.altKey && !e.ctrlKey && !e.metaKey && !typing(e.target);
}

/** True while focus is in a text field, where single-key shortcuts must not fire. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}
