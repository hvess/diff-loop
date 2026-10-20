// The window's keyboard shortcuts: which key asks for which command (diff-loop-app.md Decision 29).

/** The diff's own commands, which `DiffView` runs: they need its rows and what is on screen. */
export const LINE_COMMANDS = ["lineDown", "lineUp", "extendDown", "extendUp", "nextChange", "previousChange"] as const;
export type LineCommand = (typeof LINE_COMMANDS)[number];

/** Whether `command` is one of the diff's own (`LINE_COMMANDS`). */
export function isLineCommand(command: Command): command is LineCommand {
  return (LINE_COMMANDS as readonly Command[]).includes(command);
}

/** The window's commands, which App.tsx runs. */
export type WindowCommand =
  | "openFolder"
  | "find"
  | "findNext"
  | "findPrevious"
  | "nextFile"
  | "previousFile"
  | "nextUnviewed"
  | "previousUnviewed"
  | "toggleViewed"
  | "viewedAndNext"
  | "nextComment"
  | "previousComment"
  | "comment"
  | "editComment"
  | "deleteComment"
  | "resolveComment"
  | "undo"
  | "copyReview"
  | "preview"
  | "basePicker"
  | "unified"
  | "split"
  | "showAllLines"
  | "checkForChanges"
  | "closeFolder"
  | "switcher"
  | "escape";

/** What a key press asks for; where it may run is its `Scope` in `BINDINGS`. */
export type Command = WindowCommand | LineCommand;

/**
 * Where a command may run: `anywhere`; `window`, under no dialog, a text
 * field's focus included; `page`, under no dialog with no text field focused.
 */
export type Scope = "anywhere" | "window" | "page";

/** The key press, as `KeyboardEvent` carries it. */
export type Press = Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

/** Chord (`chordOf`) → command, scope, and whether a held key repeats it. */
const BINDINGS = new Map<string, { command: Command; scope: Scope; repeats: boolean }>([
  ["mod+o", { command: "openFolder", scope: "anywhere", repeats: false }],
  ["mod+f", { command: "find", scope: "window", repeats: false }],
  ["mod+g", { command: "findNext", scope: "window", repeats: true }],
  ["mod+shift+g", { command: "findPrevious", scope: "window", repeats: true }],
  ["j", { command: "nextFile", scope: "page", repeats: true }],
  ["k", { command: "previousFile", scope: "page", repeats: true }],
  ["]", { command: "nextFile", scope: "page", repeats: true }],
  ["[", { command: "previousFile", scope: "page", repeats: true }],
  ["shift+j", { command: "nextUnviewed", scope: "page", repeats: true }],
  ["shift+k", { command: "previousUnviewed", scope: "page", repeats: true }],
  ["v", { command: "toggleViewed", scope: "page", repeats: false }],
  ["shift+v", { command: "viewedAndNext", scope: "page", repeats: false }],
  ["n", { command: "nextComment", scope: "page", repeats: true }],
  ["p", { command: "previousComment", scope: "page", repeats: true }],
  ["c", { command: "comment", scope: "page", repeats: false }],
  ["enter", { command: "comment", scope: "page", repeats: false }],
  ["e", { command: "editComment", scope: "page", repeats: false }],
  ["r", { command: "resolveComment", scope: "page", repeats: false }],
  ["mod+backspace", { command: "deleteComment", scope: "page", repeats: false }],
  ["mod+z", { command: "undo", scope: "page", repeats: false }],
  ["mod+shift+c", { command: "copyReview", scope: "window", repeats: false }],
  ["mod+shift+p", { command: "preview", scope: "window", repeats: false }],
  ["mod+shift+b", { command: "basePicker", scope: "window", repeats: false }],
  ["mod+1", { command: "unified", scope: "window", repeats: false }],
  ["mod+2", { command: "split", scope: "window", repeats: false }],
  ["shift+x", { command: "showAllLines", scope: "page", repeats: false }],
  ["mod+r", { command: "checkForChanges", scope: "window", repeats: false }],
  ["mod+shift+w", { command: "closeFolder", scope: "page", repeats: false }],
  ["mod+k", { command: "switcher", scope: "window", repeats: false }],
  ["escape", { command: "escape", scope: "page", repeats: false }],
  ["arrowdown", { command: "lineDown", scope: "page", repeats: true }],
  ["arrowup", { command: "lineUp", scope: "page", repeats: true }],
  ["shift+arrowdown", { command: "extendDown", scope: "page", repeats: true }],
  ["shift+arrowup", { command: "extendUp", scope: "page", repeats: true }],
  ["alt+arrowdown", { command: "nextChange", scope: "page", repeats: true }],
  ["alt+arrowup", { command: "previousChange", scope: "page", repeats: true }],
]);

/** Whether `e` carries the platform's command modifier: Command on macOS, Control elsewhere. */
export const modOf = (e: Pick<KeyboardEvent, "ctrlKey" | "metaKey">, mac: boolean): boolean => (mac ? e.metaKey : e.ctrlKey);

/**
 * The press as a chord, `mod+alt+shift+<key>`, or null when it carries the
 * modifier `mod` is not (Control on macOS, Super elsewhere). A letter is named
 * in lower case with Shift as pressed, so Caps Lock changes nothing. Any other
 * character is named as typed, without Shift or Alt: they chose it, and `]`
 * needs one of them on many layouts. A digit with `mod` is named by its key's
 * place (`code`), which AZERTY types only with Shift.
 */
export function chordOf(e: Press, mac: boolean): string | null {
  const mod = modOf(e, mac);
  if (mac ? e.ctrlKey : e.metaKey) return null;
  const digit = mod ? /^Digit(\d)$/.exec(e.code)?.[1] : undefined;
  const typed = e.key.length === 1 && !/^[a-z]$/i.test(e.key);
  const name = digit ?? (typed ? e.key : e.key.toLowerCase());
  const keepsShift = digit === undefined && !typed;
  return `${mod ? "mod+" : ""}${e.altKey && keepsShift ? "alt+" : ""}${e.shiftKey && keepsShift ? "shift+" : ""}${name}`;
}

/** What `e` asks for, with where it may run and whether a held key repeats it; null for a key the window leaves alone. */
export function commandOf(e: Press, mac: boolean): { command: Command; scope: Scope; repeats: boolean } | null {
  const chord = chordOf(e, mac);
  return chord === null ? null : (BINDINGS.get(chord) ?? null);
}
