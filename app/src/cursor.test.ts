import { describe, expect, it } from "vitest";
import type { FileDiff } from "./bindings/FileDiff";
import type { Hunk } from "./bindings/Hunk";
import type { Line } from "./bindings/Line";
import { changeStarts, lineAfter, lineRows, nextIn, startRow } from "./cursor";
import { gapKey, splitRows, unifiedRows } from "./rows";

const ctx = (old: number, new_: number): Line => ({ kind: "context", old, new: new_, text: "x" });
const add = (new_: number): Line => ({ kind: "added", new: new_, text: "+" });
const del = (old: number): Line => ({ kind: "removed", old, text: "-" });
const hunk = (oldStart: number, newStart: number, lines: Line[]): Hunk => ({ oldStart, newStart, section: "", lines });

// Line 5 changed, with context 2..8; line 15 added, with context 14 and 15→16.
const second = hunk(14, 14, [ctx(14, 14), add(15), ctx(15, 16)]);
const file: FileDiff = {
  path: "a.ts",
  status: { kind: "modified" },
  content: { kind: "text", hunks: [hunk(2, 2, [ctx(2, 2), ctx(3, 3), ctx(4, 4), del(5), add(5), ctx(6, 6), ctx(7, 7), ctx(8, 8)]), second] },
};
// Rows: 0 gap, 1–3 context 2–4, 4 removed 5, 5 added 5, 6–8 context 6–8, 9 gap, 10 context 14, 11 added 15, 12 context 15→16, 13 the rest.
const rows = unifiedRows(file);
const lines = lineRows(rows);
const at = (found: ReturnType<typeof lineAfter>) => found && { row: found.row, side: found.line.side, no: found.line.no };

describe("lineRows", () => {
  it("lists the rows with a line to comment on, leaving out gaps and expanded lines", () => {
    expect(lines).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12]);
    const expanded = unifiedRows(file, { [gapKey(second)]: ["9", "10", "11", "12", "13"] });
    expect(lineRows(expanded)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 14, 15, 16]);
  });
});

describe("lineAfter", () => {
  it("steps to the next row with a line, the new side's where a row has both", () => {
    expect(at(lineAfter(rows, lines, -1, 1))).toEqual({ row: 1, side: "new", no: 2 });
    expect(at(lineAfter(rows, lines, 3, 1))).toEqual({ row: 4, side: "old", no: 5 });
    expect(at(lineAfter(rows, lines, 10, -1))).toEqual({ row: 8, side: "new", no: 8 });
  });

  it("keeps the side it is on where the row has it", () => {
    expect(at(lineAfter(rows, lines, 1, 1, "old"))).toEqual({ row: 2, side: "old", no: 3 });
    expect(at(lineAfter(rows, lines, 4, 1, "old"))).toEqual({ row: 5, side: "new", no: 5 });
  });

  it("passes over the gaps between hunks, and stops at either end", () => {
    expect(at(lineAfter(rows, lines, 8, 1))).toEqual({ row: 10, side: "new", no: 14 });
    expect(lineAfter(rows, lines, 12, 1)).toBeNull();
    expect(lineAfter(rows, lines, 1, -1)).toBeNull();
  });

  it("passes over expanded lines, which take no comment", () => {
    const expanded = unifiedRows(file, { [gapKey(second)]: ["9", "10", "11", "12", "13"] });
    expect(at(lineAfter(expanded, lineRows(expanded), 8, 1))).toEqual({ row: 14, side: "new", no: 14 });
  });
});

describe("startRow", () => {
  const shown = { startIndex: 20, endIndex: 40 };

  it("goes on from the cursor while it is on screen, its edges included", () => {
    expect(startRow(30, shown, 1, 100)).toBe(30);
    expect(startRow(20, shown, -1, 100)).toBe(20);
    expect(startRow(40, shown, 1, 100)).toBe(40);
  });

  it("enters the view from the side a move comes from when the cursor is off screen or absent", () => {
    expect(startRow(5, shown, 1, 100)).toBe(19);
    expect(startRow(90, shown, -1, 100)).toBe(41);
    expect(startRow(undefined, shown, 1, 100)).toBe(19);
    expect(startRow(undefined, shown, -1, 100)).toBe(41);
  });

  it("starts from either end of the file before the view has measured anything", () => {
    expect(startRow(undefined, null, 1, 100)).toBe(-1);
    expect(startRow(undefined, null, -1, 100)).toBe(100);
  });
});

describe("changeStarts", () => {
  it("names the first row of each run of added and removed lines", () => {
    expect(changeStarts(rows)).toEqual([4, 11]);
  });

  it("reads a split row with a removed and an added line as one change", () => {
    // Rows: 0 gap, 1–3 context, 4 removed 5 beside added 5, 5–7 context, 8 gap, 9 context, 10 added 15, ...
    expect(changeStarts(splitRows(file))).toEqual([4, 10]);
  });
});

describe("nextIn", () => {
  const starts = [4, 11];

  it("finds the next change past a row, from before the first", () => {
    expect(nextIn(starts, -1, 1)).toBe(4);
    expect(nextIn(starts, 4, 1)).toBe(11);
    expect(nextIn(starts, 11, 1)).toBeNull();
  });

  it("goes back to the start of the change it is in, then to the one before", () => {
    expect(nextIn(starts, 5, -1)).toBe(4);
    expect(nextIn(starts, 4, -1)).toBeNull();
    expect(nextIn(starts, 11, -1)).toBe(4);
    expect(nextIn(starts, 20, -1)).toBe(11);
  });

  it("finds nothing in a file with no change", () => {
    expect(nextIn([], 0, 1)).toBeNull();
    expect(nextIn([], 0, -1)).toBeNull();
  });
});
