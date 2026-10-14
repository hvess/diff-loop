import { describe, expect, it } from "vitest";
import { findIn, findTyped, marked } from "./find";
import type { Cell, SplitRow, UnifiedRow } from "./rows";

const cell = (side: "old" | "new", no: number, text: string): Cell => ({ side, no, text, change: "context", shown: false });
const hunk: UnifiedRow = { kind: "hunk", key: "h", section: "", gap: { oldFirst: 1, newFirst: 1, count: 0 } };

describe("findIn", () => {
  it("finds every match ignoring case, in reading order, skipping hunk rows", () => {
    const rows: UnifiedRow[] = [
      hunk,
      { kind: "line", key: "a", line: { kind: "added", new: 1, text: "" }, old: null, new: cell("new", 1, "userId = UserID") },
    ];
    expect(findIn(rows, "userid")).toEqual([
      { row: 1, cell: "new:1", from: 0, to: 6 },
      { row: 1, cell: "new:1", from: 9, to: 15 },
    ]);
  });

  it("searches the one cell a unified context row shows, and both sides of a split row", () => {
    const both = { old: cell("old", 3, "x"), new: cell("new", 4, "x") };
    const unified: UnifiedRow[] = [{ kind: "line", key: "a", line: { kind: "context", old: 3, new: 4, text: "x" }, ...both }];
    const split: SplitRow[] = [{ kind: "pair", key: "a", ...both }];
    expect(findIn(unified, "x").map((m) => m.cell)).toEqual(["new:4"]);
    expect(findIn(split, "x").map((m) => m.cell)).toEqual(["old:3", "new:4"]);
  });

  it("does not overlap matches, and finds nothing for an empty query", () => {
    const rows: SplitRow[] = [{ kind: "pair", key: "a", old: null, new: cell("new", 1, "aaaa") }];
    expect(findIn(rows, "aa").map((m) => m.from)).toEqual([0, 2]);
    expect(findIn(rows, "")).toEqual([]);
  });
});

describe("marked", () => {
  const tok = (content: string) => ({ content });
  const text = (pieces: { content: string; mark: string | null }[]) => pieces.map((p) => `${p.content}${p.mark ? `[${p.mark}]` : ""}`);

  it("cuts tokens where marks start and end, across token boundaries", () => {
    const pieces = marked([tok("log.warn("), tok("userId"), tok(")")], [{ from: 2, to: 11, current: true }]);
    expect(text(pieces)).toEqual(["lo", "g.warn([current]", "us[current]", "erId", ")"]);
  });

  it("leaves tokens with no mark whole", () => {
    expect(text(marked([tok("ab"), tok("cd")], []))).toEqual(["ab", "cd"]);
    expect(text(marked([tok("ab"), tok("cd")], [{ from: 2, to: 3, current: false }]))).toEqual(["ab", "c[match]", "d"]);
  });
});

describe("findTyped", () => {
  const rowsOf = (texts: string[]): SplitRow[] =>
    texts.map((t, i) => ({ kind: "pair", key: `k${i}`, old: null, new: cell("new", i + 1, t) }));

  it("finds what findIn finds as the query grows, shrinks or changes", () => {
    const rows = rowsOf(["userId = user", "nothing", "username", "USER"]);
    for (const q of ["u", "us", "use", "user", "userI", "user", "x", "user"]) {
      expect(findTyped(rows, q)).toEqual(findIn(rows, q));
    }
  });

  it("reads again from scratch for other rows", () => {
    const a = rowsOf(["abc"]);
    const b = rowsOf(["zzz", "abd"]);
    findTyped(a, "ab");
    expect(findTyped(b, "abd")).toEqual(findIn(b, "abd"));
  });
});

describe("findIn with only", () => {
  it("reads only the rows it is given", () => {
    const rows: SplitRow[] = ["ab", "ab", "ab"].map((t, i) => ({ kind: "pair", key: `k${i}`, old: null, new: cell("new", i + 1, t) }));
    expect(findIn(rows, "ab", [0, 2]).map((m) => m.row)).toEqual([0, 2]);
  });
});

describe("findTyped on Backspace", () => {
  it("gives back what a query typed on the way found, without searching again", () => {
    const rows: SplitRow[] = ["user", "use"].map((t, i) => ({ kind: "pair", key: `k${i}`, old: null, new: cell("new", i + 1, t) }));
    const typedUse = findTyped(rows, "use");
    findTyped(rows, "user");
    expect(findTyped(rows, "use")).toBe(typedUse);
  });
});
