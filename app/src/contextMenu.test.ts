import { describe, expect, it } from "vitest";
import { keepsOwnMenu } from "./contextMenu";

const el = (tagName: string) => ({ tagName, isContentEditable: false }) as unknown as EventTarget;

describe("keepsOwnMenu", () => {
  it("keeps the webview's menu in a text field", () => {
    expect(keepsOwnMenu(el("INPUT"), { isCollapsed: true })).toBe(true);
    expect(keepsOwnMenu(el("TEXTAREA"), null)).toBe(true);
  });

  it("keeps the webview's menu over selected text", () => {
    expect(keepsOwnMenu(el("SPAN"), { isCollapsed: false })).toBe(true);
  });

  it("replaces it elsewhere", () => {
    expect(keepsOwnMenu(el("DIV"), { isCollapsed: true })).toBe(false);
    expect(keepsOwnMenu(el("DIV"), null)).toBe(false);
    expect(keepsOwnMenu(null, null)).toBe(false);
  });
});
