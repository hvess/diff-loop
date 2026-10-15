import { describe, expect, it } from "vitest";
import { chordOf, commandOf, isLineCommand, type Press } from "./keys";

const press = (key: string, mods: Partial<Omit<Press, "key">> = {}): Press => ({
  key,
  code: "",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

const command = (e: Press, mac = false) => commandOf(e, mac)?.command ?? null;

describe("chordOf", () => {
  it("reads Command as the modifier on macOS and Control elsewhere", () => {
    expect(chordOf(press("o", { metaKey: true }), true)).toBe("mod+o");
    expect(chordOf(press("o", { ctrlKey: true }), false)).toBe("mod+o");
  });

  it("names no chord for the other platform's modifier", () => {
    expect(chordOf(press("j", { ctrlKey: true }), true)).toBeNull();
    expect(chordOf(press("j", { metaKey: true }), false)).toBeNull();
  });

  it("names a letter in lower case with Shift as pressed, whatever Caps Lock does", () => {
    expect(chordOf(press("J", { shiftKey: true }), false)).toBe("shift+j");
    expect(chordOf(press("J"), false)).toBe("j");
    expect(chordOf(press("C", { ctrlKey: true, shiftKey: true }), false)).toBe("mod+shift+c");
  });

  it("names another character as typed, without the Shift or Alt that typed it", () => {
    // `]` is Option-6 on a German Mac, and AltGr-9 on German Linux, which sets no altKey.
    expect(chordOf(press("]", { altKey: true }), true)).toBe("]");
    expect(chordOf(press("{", { shiftKey: true }), false)).toBe("{");
  });

  it("names a digit with the modifier by its key's place, as AZERTY types it with Shift", () => {
    expect(chordOf(press("&", { ctrlKey: true, code: "Digit1" }), false)).toBe("mod+1");
    expect(chordOf(press("2", { metaKey: true, code: "Digit2" }), true)).toBe("mod+2");
  });

  it("keeps Shift and Alt on a named key", () => {
    expect(chordOf(press("ArrowDown", { shiftKey: true }), false)).toBe("shift+arrowdown");
    expect(chordOf(press("ArrowUp", { altKey: true }), true)).toBe("alt+arrowup");
    expect(chordOf(press("Backspace", { metaKey: true }), true)).toBe("mod+backspace");
  });
});

describe("commandOf", () => {
  it("binds the review's single keys", () => {
    expect(command(press("j"))).toBe("nextFile");
    expect(command(press("k"))).toBe("previousFile");
    expect(command(press("]"))).toBe("nextFile");
    expect(command(press("["))).toBe("previousFile");
    expect(command(press("J", { shiftKey: true }))).toBe("nextUnviewed");
    expect(command(press("K", { shiftKey: true }))).toBe("previousUnviewed");
    expect(command(press("v"))).toBe("toggleViewed");
    expect(command(press("V", { shiftKey: true }))).toBe("viewedAndNext");
    expect(command(press("n"))).toBe("nextComment");
    expect(command(press("p"))).toBe("previousComment");
    expect(command(press("c"))).toBe("comment");
    expect(command(press("Enter"))).toBe("comment");
    expect(command(press("e"))).toBe("editComment");
    expect(command(press("X", { shiftKey: true }))).toBe("showAllLines");
    expect(command(press("Escape"))).toBe("escape");
  });

  it("binds the arrows to the line cursor, extending with Shift and by change with Alt", () => {
    expect(command(press("ArrowDown"))).toBe("lineDown");
    expect(command(press("ArrowUp"))).toBe("lineUp");
    expect(command(press("ArrowDown", { shiftKey: true }))).toBe("extendDown");
    expect(command(press("ArrowUp", { shiftKey: true }))).toBe("extendUp");
    expect(command(press("ArrowDown", { altKey: true }))).toBe("nextChange");
    expect(command(press("ArrowUp", { altKey: true }))).toBe("previousChange");
  });

  it("binds the command-key shortcuts the same on both platforms", () => {
    const both: [Press, Press, string][] = [
      [press("o", { metaKey: true }), press("o", { ctrlKey: true }), "openFolder"],
      [press("f", { metaKey: true }), press("f", { ctrlKey: true }), "find"],
      [press("g", { metaKey: true }), press("g", { ctrlKey: true }), "findNext"],
      [press("G", { metaKey: true, shiftKey: true }), press("G", { ctrlKey: true, shiftKey: true }), "findPrevious"],
      [press("Backspace", { metaKey: true }), press("Backspace", { ctrlKey: true }), "deleteComment"],
      [press("z", { metaKey: true }), press("z", { ctrlKey: true }), "undo"],
      [press("C", { metaKey: true, shiftKey: true }), press("C", { ctrlKey: true, shiftKey: true }), "copyReview"],
      [press("P", { metaKey: true, shiftKey: true }), press("P", { ctrlKey: true, shiftKey: true }), "preview"],
      [press("B", { metaKey: true, shiftKey: true }), press("B", { ctrlKey: true, shiftKey: true }), "basePicker"],
      [press("1", { metaKey: true, code: "Digit1" }), press("1", { ctrlKey: true, code: "Digit1" }), "unified"],
      [press("2", { metaKey: true, code: "Digit2" }), press("2", { ctrlKey: true, code: "Digit2" }), "split"],
      [press("r", { metaKey: true }), press("r", { ctrlKey: true }), "checkForChanges"],
      [press("W", { metaKey: true, shiftKey: true }), press("W", { ctrlKey: true, shiftKey: true }), "closeFolder"],
    ];
    for (const [mac, other, name] of both) {
      expect(command(mac, true)).toBe(name);
      expect(command(other, false)).toBe(name);
    }
  });

  it("leaves unbound keys, and bound letters with another modifier, to the webview", () => {
    expect(command(press("x"))).toBeNull();
    expect(command(press("N", { shiftKey: true }))).toBeNull();
    expect(command(press("j", { altKey: true }))).toBeNull();
    expect(command(press("v", { ctrlKey: true }))).toBeNull();
    expect(command(press("Enter", { ctrlKey: true }))).toBeNull();
    expect(command(press("Enter", { altKey: true }))).toBeNull();
    expect(command(press("w", { metaKey: true }), true)).toBeNull();
  });

  it("tells the diff's own commands from the window's", () => {
    for (const key of [press("ArrowDown"), press("ArrowUp", { shiftKey: true }), press("ArrowDown", { altKey: true })]) {
      expect(isLineCommand(commandOf(key, false)!.command)).toBe(true);
    }
    for (const key of [press("j"), press("Enter"), press("Escape"), press("o", { ctrlKey: true })]) {
      expect(isLineCommand(commandOf(key, false)!.command)).toBe(false);
    }
  });

  it("lets a held key repeat only a move, never a change", () => {
    expect(commandOf(press("j"), false)?.repeats).toBe(true);
    expect(commandOf(press("ArrowDown"), false)?.repeats).toBe(true);
    expect(commandOf(press("v"), false)?.repeats).toBe(false);
    expect(commandOf(press("V", { shiftKey: true }), false)?.repeats).toBe(false);
    expect(commandOf(press("Backspace", { ctrlKey: true }), false)?.repeats).toBe(false);
  });

  it("lets only Open Folder run under a dialog, and keeps letters and arrows out of text fields", () => {
    expect(commandOf(press("o", { ctrlKey: true }), false)?.scope).toBe("anywhere");
    expect(commandOf(press("C", { ctrlKey: true, shiftKey: true }), false)?.scope).toBe("window");
    expect(commandOf(press("j"), false)?.scope).toBe("page");
    expect(commandOf(press("ArrowDown"), false)?.scope).toBe("page");
    expect(commandOf(press("z", { ctrlKey: true }), false)?.scope).toBe("page");
    expect(commandOf(press("W", { ctrlKey: true, shiftKey: true }), false)?.scope).toBe("page");
  });
});
