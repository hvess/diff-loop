import { describe, expect, it } from "vitest";
import { wouldBeep } from "./platform";

const el = (tagName: string) => ({ tagName, isContentEditable: false }) as unknown as EventTarget;
const key = (k: string, target = el("DIV"), mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey", boolean>> = {}) => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target,
  ...mods,
});

describe("wouldBeep", () => {
  it("is an unmodified character outside a text field", () => {
    expect(wouldBeep(key("x"))).toBe(true);
    expect(wouldBeep(key("V"))).toBe(true);
  });

  it("is not a key WebKit handles itself", () => {
    expect(wouldBeep(key(" "))).toBe(false);
    expect(wouldBeep(key("Enter"))).toBe(false);
    expect(wouldBeep(key("ArrowDown"))).toBe(false);
    expect(wouldBeep(key("Tab"))).toBe(false);
  });

  it("is not a shortcut or typing", () => {
    expect(wouldBeep(key("c", el("DIV"), { metaKey: true }))).toBe(false);
    expect(wouldBeep(key("c", el("DIV"), { ctrlKey: true }))).toBe(false);
    expect(wouldBeep(key("c", el("DIV"), { altKey: true }))).toBe(false);
    expect(wouldBeep(key("x", el("INPUT")))).toBe(false);
    expect(wouldBeep(key("x", el("TEXTAREA")))).toBe(false);
  });
});
