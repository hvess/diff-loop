import { describe, expect, it } from "vitest";
import type { Comment } from "./bindings/Comment";
import { footOf, hasCard, kindOf, markOf, notInDiff, reopened, resolvable, toneOf } from "./lifecycle";

const draft: Comment = {
  id: "c",
  path: "a.ts",
  target: { kind: "lines", side: "new", start: 1, code: ["x"] },
  text: "t",
  suggestion: null,
  state: "current",
  place: null,
  sent: null,
  resolved: null,
  note: null,
};

const sent = (verdict: Comment["sent"] extends infer S ? (S extends { verdict: infer V } ? V : never) : never): Comment => ({
  ...draft,
  sent: {
    round: 2,
    place: { base: { kind: "uncommitted" }, head: { kind: "branch", name: "b" } },
    commit: "abc",
    target: draft.target,
    before: [],
    after: [],
    text: "t",
    suggestion: null,
    verdict,
  },
});

describe("a comment's kind", () => {
  it("is read off what the core keeps", () => {
    expect(kindOf(draft)).toBe("draft");
    expect(kindOf(sent("untouched"))).toBe("sent");
    expect(kindOf(sent("nearbyChanged"))).toBe("sent");
    expect(kindOf(sent("changed"))).toBe("changed");
    expect(kindOf(sent("removed"))).toBe("changed");
    expect(kindOf(sent("applied"))).toBe("changed");
    expect(kindOf(sent(null))).toBe("sent");
    expect(kindOf({ ...sent("untouched"), text: "edited" })).toBe("reopened");
    expect(kindOf({ ...draft, state: "lost" })).toBe("lost");
    expect(kindOf({ ...sent("untouched"), state: "outdated", sent: { ...sent("untouched").sent!, verdict: null } })).toBe("outdated");
    // Sent where it is judged, its file gone from the diff: removed, so changed, with no card.
    expect(kindOf({ ...sent("removed"), state: "outdated" })).toBe("changed");
    expect(hasCard({ ...sent("removed"), state: "outdated" })).toBe(false);
  });

  it("is reopened once the text or the suggestion differs from what was sent", () => {
    expect(reopened(draft)).toBe(false);
    expect(reopened(sent("untouched"))).toBe(false);
    expect(reopened({ ...sent("untouched"), suggestion: "y" })).toBe(true);
  });

  it("has a card only while current and open", () => {
    expect(hasCard(draft)).toBe(true);
    expect(hasCard({ ...draft, state: "lost" })).toBe(false);
    expect(hasCard({ ...sent("untouched"), resolved: "byReviewer" })).toBe(false);
    // The agent's word stays on its lines until the reviewer accepts it (ADR 0032 §2).
    expect(hasCard({ ...sent("untouched"), resolved: "byAgent" })).toBe(true);
    expect(toneOf({ ...sent("untouched"), resolved: "byAgent" })).toBe("changed");
    // A draft the agent resolved is accepted, and once accepted can be unresolved again.
    expect(resolvable({ ...draft, resolved: "byAgent" })).toBe(true);
    expect(resolvable({ ...draft, resolved: "byReviewer" })).toBe(true);
    expect(resolvable(draft)).toBe(false);
  });

  it("is not in this diff only while open and outdated without a verdict", () => {
    expect(notInDiff({ ...draft, state: "outdated" })).toBe(true);
    expect(notInDiff({ ...draft, state: "outdated", resolved: "byReviewer" })).toBe(false);
    // Its file gone where it is judged: changed, as the list draws it, not "not in this diff".
    expect(notInDiff({ ...sent("removed"), state: "outdated" })).toBe(false);
    expect(notInDiff(draft)).toBe(false);
  });

  it("takes the accent while the reviewer holds it, amber once its code changed, grey once sent or resolved", () => {
    expect(toneOf(draft)).toBe("");
    expect(toneOf({ ...sent("untouched"), text: "edited" })).toBe("");
    expect(toneOf(sent("changed"))).toBe("changed");
    expect(toneOf(sent("untouched"))).toBe("sent");
    expect(toneOf({ ...draft, state: "lost" })).toBe("sent");
    expect(toneOf({ ...sent("changed"), resolved: "byReviewer" })).toBe("sent");
  });

  it("can be resolved only once sent", () => {
    expect(resolvable(draft)).toBe(false);
    expect(resolvable({ ...sent("untouched"), text: "edited" })).toBe(true);
  });
});

describe("the words for a comment", () => {
  it("mark each kind, and a resolved one by how it was resolved", () => {
    expect(markOf(draft)).toBe("");
    expect(markOf(sent("untouched"))).toBe("Sent");
    expect(markOf(sent("changed"))).toBe("Changed");
    expect(markOf({ ...draft, state: "lost" })).toBe("Code gone");
    expect(markOf({ ...draft, state: "outdated" })).toBe("Not in this diff");
    expect(markOf({ ...sent("untouched"), resolved: "byReviewer" })).toBe("Resolved");
    expect(markOf({ ...sent("applied"), resolved: "suggestionApplied" })).toBe("Resolved · suggestion applied");
    expect(markOf({ ...sent("untouched"), resolved: "byAgent", note: "Done." })).toBe("Resolved by agent");
  });

  it("say what became of sent code in the card's footer", () => {
    expect(footOf(sent("untouched"))).toBe("Untouched since sent");
    expect(footOf(sent("nearbyChanged"))).toBe("Untouched since sent · nearby lines changed");
    expect(footOf(sent("changed"))).toBe("The code changed after you sent this. Resolve it if the change answers you.");
    expect(footOf({ ...sent("changed"), resolved: "byAgent", note: "Done." })).toBe(
      "The code changed after you sent this. Accept it if the change answers you.",
    );
    expect(footOf(sent("removed"))).toBe("Code removed since sent");
    expect(footOf(sent(null))).toBe("");
  });
});
