// A file's hunks laid out as the rows the diff view draws.
import type { FileDiff } from "./bindings/FileDiff";
import type { Hunk } from "./bindings/Hunk";
import type { Line } from "./bindings/Line";
import type { Side } from "./bindings/Side";

/** One side of a line: its number there, and its text. */
export type Cell = { side: Side; no: number; text: string; change: "added" | "removed" | "context" };

export type HunkRow = { kind: "hunk"; key: string; section: string; hidden: number };
export type UnifiedRow =
  | HunkRow
  | { kind: "line"; key: string; line: Line; old: Cell | null; new: Cell | null };
export type SplitRow =
  | HunkRow
  | { kind: "pair"; key: string; old: Cell | null; new: Cell | null };

export function hunksOf(file: FileDiff): Hunk[] {
  return file.content.kind === "text" ? file.content.hunks : [];
}

function cells(line: Line): { old: Cell | null; new: Cell | null } {
  switch (line.kind) {
    case "context":
      return {
        old: { side: "old", no: line.old, text: line.text, change: "context" },
        new: { side: "new", no: line.new, text: line.text, change: "context" },
      };
    case "added":
      return { old: null, new: { side: "new", no: line.new, text: line.text, change: "added" } };
    case "removed":
      return { old: { side: "old", no: line.old, text: line.text, change: "removed" }, new: null };
  }
}

/**
 * A row's identity: its line numbers, unique within a file. Stable across a
 * refresh for lines that kept their numbers, so measured heights follow them.
 */
function rowKey(old: Cell | null, new_: Cell | null): string {
  return `${old?.no ?? ""}:${new_?.no ?? ""}`;
}

/** Unchanged lines between the end of the previous hunk and `hunk`. */
function hiddenBefore(hunk: Hunk, previous: Hunk | undefined): number {
  if (!previous) return Math.max(0, hunk.newStart - 1);
  let end = previous.newStart;
  for (const line of previous.lines) if (line.kind !== "removed") end += 1;
  return Math.max(0, hunk.newStart - end);
}

/** The header row before `hunk`, or none for a file's first hunk when nothing precedes it. */
function header(hunk: Hunk, h: number, all: Hunk[]): HunkRow[] {
  const hidden = hiddenBefore(hunk, all[h - 1]);
  return h === 0 && hidden === 0
    ? []
    : [{ kind: "hunk", key: `h:${hunk.oldStart}:${hunk.newStart}`, section: hunk.section, hidden }];
}

export function unifiedRows(file: FileDiff): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  hunksOf(file).forEach((hunk, h, all) => {
    rows.push(...header(hunk, h, all));
    for (const line of hunk.lines) {
      const c = cells(line);
      rows.push({ kind: "line", key: rowKey(c.old, c.new), line, ...c });
    }
  });
  return rows;
}

/** Removed and added runs side by side, paired line for line. */
export function splitRows(file: FileDiff): SplitRow[] {
  const rows: SplitRow[] = [];
  hunksOf(file).forEach((hunk, h, all) => {
    rows.push(...header(hunk, h, all));
    let removed: Cell[] = [];
    let added: Cell[] = [];
    const flush = () => {
      for (let i = 0; i < Math.max(removed.length, added.length); i++) {
        const old = removed[i] ?? null;
        const next = added[i] ?? null;
        rows.push({ kind: "pair", key: rowKey(old, next), old, new: next });
      }
      removed = [];
      added = [];
    };
    for (const line of hunk.lines) {
      const c = cells(line);
      if (line.kind === "removed" && c.old) removed.push(c.old);
      else if (line.kind === "added" && c.new) added.push(c.new);
      else {
        flush();
        rows.push({ kind: "pair", key: rowKey(c.old, c.new), ...c });
      }
    }
    flush();
  });
  return rows;
}

/** The last line a line comment covers; mirrors diff-loop-core's `Target::end`. */
export function lastLine(target: { start: number; code: string[] }): number {
  return target.start + Math.max(0, target.code.length - 1);
}

/** Each hunk's first and last line number on each side, in order. */
type Bounds = Record<Side, [number, number][]>;

/** Per file, built on first use; FileDiff objects are replaced, never mutated. */
const boundsCache = new WeakMap<FileDiff, Bounds>();

function boundsOf(file: FileDiff): Bounds {
  let bounds = boundsCache.get(file);
  if (!bounds) {
    bounds = { old: [], new: [] };
    for (const hunk of hunksOf(file)) {
      for (const side of ["old", "new"] as const) {
        const numbers = hunk.lines.flatMap((line) => cells(line)[side]?.no ?? []);
        const first = numbers[0];
        const last = numbers[numbers.length - 1];
        if (first !== undefined && last !== undefined) bounds[side].push([first, last]);
      }
    }
    boundsCache.set(file, bounds);
  }
  return bounds;
}

/**
 * `head` moved toward `anchor` until both lie in the same hunk on `side`, so a
 * range never spans lines the diff hides: a comment's `code` has one entry per
 * line it covers (diff-loop-core `Target::Lines`). O(log h) for h hunks after
 * the file's first call.
 */
export function withinHunk(file: FileDiff, side: Side, anchor: number, head: number): number {
  const spans = boundsOf(file)[side];
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [first, last] = spans[mid]!;
    if (anchor < first) hi = mid - 1;
    else if (anchor > last) lo = mid + 1;
    else return Math.min(last, Math.max(first, head));
  }
  return anchor;
}

/** The text of lines `start..=end` on `side`, in order; lines the diff does not show are skipped. */
export function linesOn(file: FileDiff, side: Side, start: number, end: number): string[] {
  const out: string[] = [];
  for (const hunk of hunksOf(file)) {
    for (const line of hunk.lines) {
      const cell = cells(line)[side];
      if (cell && cell.no >= start && cell.no <= end) out.push(cell.text);
    }
  }
  return out;
}

type Counts = { added: number; removed: number };

/** Per file, built on first use, like `boundsCache`: a refresh carries unchanged files over. */
const countsCache = new WeakMap<FileDiff, Counts>();

/** Added and removed lines in `file`; O(1) after the file's first call. */
export function counts(file: FileDiff): Counts {
  let cached = countsCache.get(file);
  if (!cached) {
    cached = { added: 0, removed: 0 };
    for (const hunk of hunksOf(file)) {
      for (const line of hunk.lines) {
        if (line.kind === "added") cached.added++;
        else if (line.kind === "removed") cached.removed++;
      }
    }
    countsCache.set(file, cached);
  }
  return cached;
}
