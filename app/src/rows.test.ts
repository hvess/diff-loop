import { describe, expect, it } from "vitest";
import type { FileDiff } from "./bindings/FileDiff";
import type { Hunk } from "./bindings/Hunk";
import type { Line } from "./bindings/Line";
import { type Cell, gapAfter, gapBefore, gutterLine, REST, splitRows, unifiedRows } from "./rows";

const ctx = (old: number, new_: number): Line => ({ kind: "context", old, new: new_, text: "x" });
const add = (new_: number): Line => ({ kind: "added", new: new_, text: "+" });
const del = (old: number): Line => ({ kind: "removed", old, text: "-" });
const hunk = (oldStart: number, newStart: number, lines: Line[]): Hunk => ({ oldStart, newStart, section: "", lines });
const modified = (hunks: Hunk[]): FileDiff => ({
  path: "a.ts",
  status: { kind: "modified" },
  content: { kind: "text", hunks },
});

// Line 5 changed, with context 2..8; line 15 added, with context 14 and 15→16.
const first = hunk(2, 2, [ctx(2, 2), ctx(3, 3), ctx(4, 4), del(5), add(5), ctx(6, 6), ctx(7, 7), ctx(8, 8)]);
const second = hunk(14, 14, [ctx(14, 14), add(15), ctx(15, 16)]);
const file = modified([first, second]);

describe("gapBefore", () => {
  it("counts the lines before the first hunk and between hunks", () => {
    expect(gapBefore(first, undefined)).toEqual({ oldFirst: 1, newFirst: 1, count: 1 });
    expect(gapBefore(second, first)).toEqual({ oldFirst: 9, newFirst: 9, count: 5 });
  });

  /** Regression: git's `+4,0` names the line before a pure deletion, and the count was one short. */
  it("counts every line before a hunk that only removes lines", () => {
    const removal = hunk(5, 4, [del(5)]);
    expect(gapBefore(removal, undefined)).toEqual({ oldFirst: 1, newFirst: 1, count: 4 });
    expect(gapBefore(hunk(10, 9, [ctx(10, 9)]), removal)).toEqual({ oldFirst: 6, newFirst: 5, count: 4 });
  });

  it("counts the lines around a hunk that only adds lines", () => {
    const addition = hunk(3, 4, [add(4)]);
    expect(gapBefore(addition, undefined)).toEqual({ oldFirst: 1, newFirst: 1, count: 3 });
    expect(gapBefore(hunk(10, 10, [ctx(10, 10)]), addition)).toEqual({ oldFirst: 4, newFirst: 5, count: 5 });
  });
});

describe("gapAfter", () => {
  it("starts after the last hunk on each side, its length unknown", () => {
    expect(gapAfter(file)).toEqual({ oldFirst: 16, newFirst: 17, count: null });
  });

  it("is absent where the diff is the whole file", () => {
    expect(gapAfter({ ...file, status: { kind: "added" } })).toBeNull();
    expect(gapAfter({ ...file, status: { kind: "deleted" } })).toBeNull();
  });
});

describe("expanded rows", () => {
  it("replace a gap's header with its lines, numbered on both sides and not commentable", () => {
    const rows = unifiedRows(file, { "h:14:14": ["9", "10", "11", "12", "13"] });
    const shown = rows.flatMap((r) => (r.kind === "line" && r.new?.shown ? [[r.old?.no, r.new.no, r.new.text]] : []));
    expect(shown).toEqual([
      [9, 9, "9"],
      [10, 10, "10"],
      [11, 11, "11"],
      [12, 12, "12"],
      [13, 13, "13"],
    ]);
    expect(rows.filter((r) => r.kind === "hunk").map((r) => r.key)).toEqual(["h:2:2", REST]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("follow the last hunk when the rest of the file is read, in both layouts", () => {
    expect(unifiedRows(file).at(-1)).toEqual({ kind: "hunk", key: REST, section: "", gap: gapAfter(file) });
    const unified = unifiedRows(file, { [REST]: ["a", "b"] });
    expect(unified.slice(-2).map((r) => (r.kind === "line" ? [r.old?.no, r.new?.no] : null))).toEqual([
      [16, 17],
      [17, 18],
    ]);
    const split = splitRows(file, { [REST]: ["a"] }).at(-1);
    expect(split?.kind === "pair" && [split.old?.no, split.new?.no, split.new?.shown]).toEqual([16, 17, true]);
  });

  it("leave no row when the rest of the file is empty", () => {
    expect(unifiedRows(file, { [REST]: [] }).at(-1)?.kind).toBe("line");
  });

  it("are not shown while loading or after a failed read", () => {
    expect(unifiedRows(file, { [REST]: "loading" }).at(-1)?.kind).toBe("hunk");
    expect(unifiedRows(file, { [REST]: "failed" }).at(-1)?.kind).toBe("hunk");
  });
});

describe("gutterLine", () => {
  const cell = (side: Cell["side"], change: Cell["change"], shown = false): Cell => ({ side, no: 3, text: "x", change, shown });

  it("takes the side an added or removed line has", () => {
    expect(gutterLine([null, cell("new", "added")])).toEqual(cell("new", "added"));
    expect(gutterLine([cell("old", "removed"), null])).toEqual(cell("old", "removed"));
    expect(gutterLine([cell("old", "removed")])).toEqual(cell("old", "removed"));
  });

  it("takes the new side of a context line, in either order", () => {
    expect(gutterLine([cell("old", "context"), cell("new", "context")])?.side).toBe("new");
    expect(gutterLine([cell("new", "context"), cell("old", "context")])?.side).toBe("new");
  });

  it("takes no line that cannot be commented on", () => {
    expect(gutterLine([cell("old", "context", true), cell("new", "context", true)])).toBeUndefined();
    expect(gutterLine([null])).toBeUndefined();
    expect(gutterLine([])).toBeUndefined();
  });
});
