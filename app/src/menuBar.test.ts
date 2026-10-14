import { describe, expect, it, vi } from "vitest";
import type { Comment } from "./bindings/Comment";
import { menuState, sameMenuState } from "./menuBar";
import { type LoadedReview, useStore } from "./store";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

type Store = ReturnType<typeof useStore.getState>;

const comment = (state: Comment["state"]): Comment => ({
  id: state,
  path: "a.ts",
  target: { kind: "file" },
  text: "t",
  suggestion: null,
  state,
});

const store = (patch: Partial<Store>): Store => ({ ...useStore.getState(), ...patch });
const review = { byPath: new Map([["a.ts", {}]]) } as unknown as LoadedReview;

describe("menuState", () => {
  it("disables everything with no review open", () => {
    expect(menuState(store({}))).toEqual({ open: false, unified: true, viewed: null, hasComments: false, canComment: false });
  });

  it("reads the selected file's viewed mark, only for a file in the review", () => {
    const viewed = new Map([["a.ts", "sig"]]);
    expect(menuState(store({ review, selected: "a.ts", viewed })).viewed).toBe(true);
    expect(menuState(store({ review, selected: "a.ts" })).viewed).toBe(false);
    expect(menuState(store({ review, selected: "gone.ts", viewed })).viewed).toBeNull();
  });

  it("offers jumping only to comments in this diff", () => {
    expect(menuState(store({ comments: [comment("outdated")] })).hasComments).toBe(false);
    expect(menuState(store({ comments: [comment("outdated"), comment("current")] })).hasComments).toBe(true);
  });

  it("offers commenting only on selected lines, and not while writing a comment", () => {
    const selection = { path: "a.ts", side: "new" as const, anchor: 1, head: 3, dragging: false };
    expect(menuState(store({ selection })).canComment).toBe(true);
    expect(menuState(store({ selection, composer: { path: "a.ts" } as Store["composer"] })).canComment).toBe(false);
  });
});

describe("sameMenuState", () => {
  it("tells any changed field", () => {
    const base = { open: true, unified: true, viewed: null, hasComments: false, canComment: false };
    expect(sameMenuState(base, { ...base })).toBe(true);
    for (const patch of [{ open: false }, { unified: false }, { viewed: false }, { hasComments: true }, { canComment: true }]) {
      expect(sameMenuState(base, { ...base, ...patch })).toBe(false);
    }
  });
});
