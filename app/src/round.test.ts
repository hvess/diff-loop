import { describe, expect, it } from "vitest";
import type { Comment } from "./bindings/Comment";
import type { Round } from "./bindings/Round";
import { previewSubtitle, roundStrip } from "./round";

const draft = (id: string): Comment => ({
  id,
  path: "a.ts",
  target: { kind: "file" },
  text: "t",
  suggestion: null,
  state: "current",
  place: null,
  sent: null,
  resolved: null,
});

const inRound = (id: string, round: number, verdict: "untouched" | "changed" | "applied" | null, resolved = false): Comment => ({
  ...draft(id),
  sent: {
    round,
    place: { base: { kind: "uncommitted" }, head: { kind: "branch", name: "b" } },
    commit: null,
    target: { kind: "file" },
    before: [],
    after: [],
    text: "t",
    suggestion: null,
    verdict,
  },
  resolved: resolved ? "byReviewer" : null,
});

const round = (number: number): Round => ({ number, at: 0, place: { base: { kind: "uncommitted" }, head: { kind: "branch", name: "b" } }, commit: null, markdown: "" });

describe("the round strip", () => {
  it("counts drafts while nothing was sent", () => {
    expect(roundStrip([], [draft("a"), draft("b")], 0, 0)).toEqual({ title: "Nothing sent yet", quiet: true, parts: [], meta: "2 drafts" });
    expect(roundStrip([], [], 0, 0).meta).toBe("");
  });

  it("reads as just sent until the agent's work shows", () => {
    const strip = roundStrip([round(2)], [inRound("a", 2, "untouched"), inRound("b", 2, "untouched"), draft("d")], 0, 5 * 60_000);
    expect(strip).toEqual({ title: "Round 2 sent", quiet: false, parts: [{ filter: null, glyph: "sent", text: "2 comments" }], meta: "5 min ago" });
  });

  it("then counts what changed and what did not, and what resolved itself", () => {
    const comments = [inRound("a", 2, "changed"), inRound("b", 2, "untouched"), inRound("c", 2, "applied", true), inRound("old", 1, "untouched")];
    expect(roundStrip([round(1), round(2)], comments, 1, 0)).toEqual({
      title: "Round 2",
      quiet: false,
      parts: [
        { filter: "changed", glyph: "changed", text: "1 changed" },
        { filter: "untouched", glyph: "sent", text: "1 untouched" },
        { filter: null, glyph: null, text: "1 resolved automatically" },
      ],
      meta: "",
    });
  });

  it("counts a reopened comment as neither changed nor untouched", () => {
    const reopened = { ...inRound("r", 1, "untouched"), text: "edited" };
    expect(roundStrip([round(1)], [inRound("a", 1, "changed"), reopened], 0, 0).parts).toEqual([{ filter: "changed", glyph: "changed", text: "1 changed" }]);
  });

  it("counts a round whose comments were resolved by hand as no longer just sent", () => {
    const strip = roundStrip([round(1)], [inRound("a", 1, "untouched", true), inRound("b", 1, "untouched")], 0, 0);
    expect(strip.title).toBe("Round 1");
    expect(strip.parts).toEqual([{ filter: "untouched", glyph: "sent", text: "1 untouched" }]);
  });
});

describe("the preview's subtitle", () => {
  it("counts comments and files before any round, then new against still open", () => {
    expect(previewSubtitle([draft("a"), { ...draft("b"), path: "b.ts" }], 0)).toBe("2 comments across 2 files");
    const reopened = { ...inRound("r", 1, "untouched"), text: "edited" };
    expect(previewSubtitle([draft("a"), reopened, inRound("s", 1, "untouched"), inRound("x", 1, "untouched", true)], 1)).toBe("2 new · 1 still open");
  });
});
