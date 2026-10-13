// A file's hunks laid out as the rows the diff view draws.
import type { FileDiff } from "./bindings/FileDiff";
import type { Hunk } from "./bindings/Hunk";
import type { Line } from "./bindings/Line";
import type { Side } from "./bindings/Side";

/**
 * One side of a line: its number there, and its text. `shown` lines were
 * expanded from the file, not sent in the diff, so no comment can anchor on
 * them: a comment's code comes from the diff (diff-loop-core `Target::Lines`).
 */
export type Cell = { side: Side; no: number; text: string; change: "added" | "removed" | "context"; shown: boolean };

/**
 * Unchanged lines the diff leaves out: the first on each side, and how many;
 * `count` is null after the last hunk, where the file's length is unknown.
 */
export type Gap = { oldFirst: number; newFirst: number; count: number | null };

export type HunkRow = { kind: "hunk"; key: string; section: string; gap: Gap };

/** Gap key → the gap's lines from the new side once read, or how reading them stands. */
export type Expanded = Record<string, string[] | "loading" | "failed">;
export type UnifiedRow =
  | HunkRow
  | { kind: "line"; key: string; line: Line; old: Cell | null; new: Cell | null };
export type SplitRow =
  | HunkRow
  | { kind: "pair"; key: string; old: Cell | null; new: Cell | null };

export function hunksOf(file: FileDiff): Hunk[] {
  return file.content.kind === "text" ? file.content.hunks : [];
}

function cells(line: Line, shown = false): { old: Cell | null; new: Cell | null } {
  switch (line.kind) {
    case "context":
      return {
        old: { side: "old", no: line.old, text: line.text, change: "context", shown },
        new: { side: "new", no: line.new, text: line.text, change: "context", shown },
      };
    case "added":
      return { old: null, new: { side: "new", no: line.new, text: line.text, change: "added", shown } };
    case "removed":
      return { old: { side: "old", no: line.old, text: line.text, change: "removed", shown }, new: null };
  }
}

/**
 * A row's identity: its line numbers, unique within a file. Stable across a
 * refresh for lines that kept their numbers, so measured heights follow them.
 */
function rowKey(old: Cell | null, new_: Cell | null): string {
  return `${old?.no ?? ""}:${new_?.no ?? ""}`;
}

/** The first and last line number `hunk` shows on `side`, if it shows any there. */
function span(hunk: Hunk, side: Side): [number, number] | null {
  const numbers = hunk.lines.flatMap((line) => cells(line)[side]?.no ?? []);
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return first === undefined || last === undefined ? null : [first, last];
}

/**
 * The unchanged lines between `previous` (or the file's start) and `hunk`.
 * A hunk showing no line on a side has `start` 0, or names the line before
 * it there (git's `-N,0` / `+N,0`), so its own lines decide where possible.
 */
export function gapBefore(hunk: Hunk, previous: Hunk | undefined): Gap {
  const end = (side: Side, start: number) => (previous ? (span(previous, side)?.[1] ?? start) : 0);
  const oldFirst = end("old", previous?.oldStart ?? 0) + 1;
  const newFirst = end("new", previous?.newStart ?? 0) + 1;
  const next = span(hunk, "new")?.[0] ?? hunk.newStart + 1;
  return { oldFirst, newFirst, count: Math.max(0, next - newFirst) };
}

/** The key a gap is expanded under: its hunk's, unique within a file. */
export function gapKey(hunk: Hunk): string {
  return `h:${hunk.oldStart}:${hunk.newStart}`;
}

/** The key of the gap after the last hunk. */
export const REST = "rest";

/**
 * The lines after `file`'s last hunk, or null when nothing can follow it:
 * an added or deleted file's diff is the whole file.
 */
export function gapAfter(file: FileDiff): Gap | null {
  const last = hunksOf(file).at(-1);
  if (!last || file.status.kind === "added" || file.status.kind === "deleted") return null;
  const oldFirst = (span(last, "old")?.[1] ?? last.oldStart) + 1;
  const newFirst = (span(last, "new")?.[1] ?? last.newStart) + 1;
  return { oldFirst, newFirst, count: null };
}

/** `gap`'s rows: its lines once read, else the row offering to read them. */
function gapRows(gap: Gap, key: string, section: string, expanded: Expanded | undefined): UnifiedRow[] {
  const texts = expanded?.[key];
  if (!Array.isArray(texts)) return [{ kind: "hunk", key, section, gap }];
  return texts.map((text, i) => {
    const line: Line = { kind: "context", old: gap.oldFirst + i, new: gap.newFirst + i, text };
    const c = cells(line, true);
    return { kind: "line", key: rowKey(c.old, c.new), line, ...c };
  });
}

/** What precedes `hunk`: its gap's rows; nothing for a first hunk at line 1. */
function before(hunk: Hunk, h: number, all: Hunk[], expanded: Expanded | undefined): UnifiedRow[] {
  const gap = gapBefore(hunk, all[h - 1]);
  return h === 0 && gap.count === 0 ? [] : gapRows(gap, gapKey(hunk), hunk.section, expanded);
}

/** What follows the last hunk: the rest of the file's rows, if anything can follow. */
function after(file: FileDiff, expanded: Expanded | undefined): UnifiedRow[] {
  const gap = gapAfter(file);
  return gap ? gapRows(gap, REST, "", expanded) : [];
}

/** A unified row as a split one: shown lines are context, the same on both sides. */
function split(row: UnifiedRow): SplitRow {
  return row.kind === "hunk" ? row : { kind: "pair", key: row.key, old: row.old, new: row.new };
}

export function unifiedRows(file: FileDiff, expanded?: Expanded): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  hunksOf(file).forEach((hunk, h, all) => {
    rows.push(...before(hunk, h, all, expanded));
    for (const line of hunk.lines) {
      const c = cells(line);
      rows.push({ kind: "line", key: rowKey(c.old, c.new), line, ...c });
    }
  });
  rows.push(...after(file, expanded));
  return rows;
}

/** Removed and added runs side by side, paired line for line. */
export function splitRows(file: FileDiff, expanded?: Expanded): SplitRow[] {
  const rows: SplitRow[] = [];
  hunksOf(file).forEach((hunk, h, all) => {
    rows.push(...before(hunk, h, all, expanded).map(split));
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
  rows.push(...after(file, expanded).map(split));
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
        const bound = span(hunk, side);
        if (bound) bounds[side].push(bound);
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
