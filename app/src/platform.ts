// Per-platform conventions the UI follows.

export const isMac = navigator.userAgent.includes("Mac");

/** The platform's command modifier, as shown in labels. */
export const modKey = isMac ? "⌘" : "Ctrl+";

/** Whether `e` carries the platform's command modifier. */
export const hasMod = (e: KeyboardEvent | React.KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

/** True while focus is in a text field, where single-key shortcuts must not fire. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}
