import { describe, expect, it } from "vitest";
import type { FileDiff } from "./bindings/FileDiff";
import type { Hunk } from "./bindings/Hunk";
import type { Line } from "./bindings/Line";
import { linesOf, placed, type Token } from "./highlight";
import { gapKey } from "./rows";

const ctx = (old: number, new_: number, text: string): Line => ({ kind: "context", old, new: new_, text });
const hunk = (oldStart: number, newStart: number, lines: Line[]): Hunk => ({ oldStart, newStart, section: "", lines });
const file = (hunks: Hunk[]): FileDiff => ({ path: "a.ts", status: { kind: "modified" }, content: { kind: "text", hunks } });

// Line 4 removed and line 4 added, inside context 3 and 5; lines 1–2 unchanged before it.
const change = hunk(3, 3, [
  ctx(3, 3, "c"),
  { kind: "removed", old: 4, text: "old" },
  { kind: "added", new: 4, text: "new" },
  ctx(5, 5, "e"),
]);

describe("linesOf", () => {
  it("puts each side's lines in file order", () => {
    expect(linesOf(file([change]), undefined)).toEqual({
      old: [
        { no: 3, text: "c" },
        { no: 4, text: "old" },
        { no: 5, text: "e" },
      ],
      new: [
        { no: 3, text: "c" },
        { no: 4, text: "new" },
        { no: 5, text: "e" },
      ],
    });
  });

  it("puts a gap's expanded lines before their hunk", () => {
    const lines = linesOf(file([change]), { [gapKey(change)]: ["a", "b"] });
    expect(lines?.new.slice(0, 3)).toEqual([
      { no: 1, text: "a" },
      { no: 2, text: "b" },
      { no: 3, text: "c" },
    ]);
  });

  it("leaves a file showing more than 5000 lines plain", () => {
    const long = hunk(1, 1, Array.from({ length: 5001 }, (_, i) => ctx(i + 1, i + 1, "x")));
    expect(linesOf(file([long]), undefined)).toBeNull();
    expect(linesOf(file([hunk(1, 1, long.lines.slice(0, 5000))]), undefined)).not.toBeNull();
  });
});

describe("placed", () => {
  it("puts each row of tokens at the line number it was sent for", () => {
    const t = (content: string): Token[] => [{ content, color: undefined, italic: false }];
    const lines = { old: [{ no: 7, text: "x" }], new: [{ no: 9, text: "y" }, { no: 10, text: "z" }] };
    const out = placed(lines, { old: [t("x")], new: [t("y"), t("z")] });
    expect(out.old.get(7)).toEqual(t("x"));
    expect([...out.new.keys()]).toEqual([9, 10]);
  });
});
