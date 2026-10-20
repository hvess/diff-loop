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
  place: null,
  sent: null,
  resolved: null,
});

const store = (patch: Partial<Store>): Store => ({ ...useStore.getState(), ...patch });
const review = { byPath: new Map([["a.ts", {}]]) } as unknown as LoadedReview;

describe("menuState", () => {
  it("disables everything with no review open", () => {
    expect(menuState(store({}))).toEqual({ open: false, unified: true, viewed: null, hasComments: false, canComment: false, finding: false, resolve: null });
  });

  it("reads the selected file's viewed mark, only for a file in the review", () => {
    const viewed = new Map([["a.ts", "sig"]]);
    expect(menuState(store({ review, selected: "a.ts", viewed })).viewed).toBe(true);
    expect(menuState(store({ review, selected: "a.ts" })).viewed).toBe(false);
    expect(menuState(store({ review, selected: "gone.ts", viewed })).viewed).toBeNull();
  });

  it("offers jumping only to comments with a card", () => {
    expect(menuState(store({ comments: [comment("outdated"), comment("lost")] })).hasComments).toBe(false);
    expect(menuState(store({ comments: [comment("outdated"), comment("current")] })).hasComments).toBe(true);
    expect(menuState(store({ comments: [{ ...comment("current"), resolved: "byReviewer" }] })).hasComments).toBe(false);
  });

  it("offers Resolve for an open sent comment, Unresolve once resolved, and nothing for a draft", () => {
    const sent = { round: 1, place: { base: { kind: "uncommitted" as const }, head: { kind: "branch" as const, name: "b" } }, commit: null, target: { kind: "file" as const }, before: [], after: [], text: "t", suggestion: null, verdict: null };
    expect(menuState(store({ comments: [comment("current")], openComment: "current" })).resolve).toBeNull();
    expect(menuState(store({ comments: [{ ...comment("current"), sent }], openComment: "current" })).resolve).toBe("resolve");
    expect(menuState(store({ comments: [{ ...comment("current"), sent, resolved: "byReviewer" }], openComment: "current" })).resolve).toBe("unresolve");
  });

  it("offers commenting only on selected lines of a branch, and not while writing a comment", () => {
    const selection = { path: "a.ts", side: "new" as const, anchor: 1, head: 3, dragging: false };
    const key = { project: "/p/.git", branch: "b" };
    expect(menuState(store({ selection, key })).canComment).toBe(true);
    expect(menuState(store({ selection, key, composer: { path: "a.ts" } as Store["composer"] })).canComment).toBe(false);
    // A detached HEAD has no review to keep a comment in (ADR 0026 §5).
    expect(menuState(store({ selection, key: null })).canComment).toBe(false);
  });
});

describe("sameMenuState", () => {
  it("tells any changed field", () => {
    const base = { open: true, unified: true, viewed: null, hasComments: false, canComment: false, finding: false, resolve: null };
    expect(sameMenuState(base, { ...base })).toBe(true);
    for (const patch of [{ open: false }, { unified: false }, { viewed: false }, { hasComments: true }, { canComment: true }, { finding: true }, { resolve: "resolve" as const }]) {
      expect(sameMenuState(base, { ...base, ...patch })).toBe(false);
    }
  });
});
