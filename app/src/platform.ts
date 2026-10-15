// Per-platform conventions the UI follows.
import { commandOf, modOf, type Scope } from "./keys";

export const isMac = navigator.userAgent.includes("Mac");

/** The platform's command modifier, as shown in labels. */
export const modKey = isMac ? "⌘" : "Ctrl+";

/** Whether `e` carries the platform's command modifier. */
export const hasMod = (e: KeyboardEvent | React.KeyboardEvent) => modOf(e, isMac);

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

/** Whether a dialog is open: the window's own keys and menu commands then wait. */
export function dialogOpen(): boolean {
  return document.querySelector("[role=dialog]") !== null;
}

/** Whether a command of `scope` may run now for a key aimed at `target` (keys.ts). */
export function inScope(scope: Scope, target: EventTarget | null): boolean {
  if (scope === "anywhere") return true;
  if (dialogOpen()) return false;
  return scope === "window" || !typing(target);
}

/**
 * The binding `e` asks for (keys.ts), if it may run now: no focused control
 * took the key, it is in scope, and a held key repeats it only where the
 * binding allows. The one rule App.tsx's and DiffView's handlers both follow.
 */
export function bindingFor(e: KeyboardEvent): ReturnType<typeof commandOf> {
  if (e.defaultPrevented) return null;
  const bound = commandOf(e, isMac);
  return bound && inScope(bound.scope, e.target) && (!e.repeat || bound.repeats) ? bound : null;
}

/** True when focus is on no control: Return is then the window's, not a focused button's. */
export function onPage(target: EventTarget | null): boolean {
  return target === document.body;
}

/** Whether the find bar is drawn (its `role="search"`, FindBar.tsx): a file without a diff has none, though find stays open. */
export function findShown(): boolean {
  return document.querySelector("[role=search]") !== null;
}
