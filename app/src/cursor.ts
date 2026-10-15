// Moving the line cursor (the selection, `Selection` in store.ts) through a file's rows by key.
import type { Side } from "./bindings/Side";
import { type Cell, gutterLine, type SplitRow, type UnifiedRow } from "./rows";

type Row = UnifiedRow | SplitRow;

/** The line a row's cursor sits on: the one on `side` when it can take a comment there, else `gutterLine`'s. */
function lineOf(row: Row, side: Side | undefined): Cell | undefined {
  if (row.kind === "hunk") return undefined;
  const live = [row.old, row.new].filter((c): c is Cell => c !== null && !c.shown);
  return live.find((c) => c.side === side) ?? gutterLine(live);
}

/**
 * The rows with a line that can take a comment, in order: hunk rows and
 * expanded lines take none (diff-loop-app.md Decision 9). O(rows), once per layout.
 */
export function lineRows(rows: readonly Row[]): number[] {
  return rows.flatMap((row, i) => (lineOf(row, undefined) ? [i] : []));
}

/**
 * The row a move goes on from: the cursor's while it is on screen (`shown`,
 * the rows the view overlaps); else, entering the view from the side the move
 * comes from, the row above its first going down, below its last going up.
 */
export function startRow(
  cursor: number | undefined,
  shown: { startIndex: number; endIndex: number } | null,
  step: 1 | -1,
  rowCount: number,
): number {
  if (cursor !== undefined && shown && cursor >= shown.startIndex && cursor <= shown.endIndex) return cursor;
  return step === 1 ? (shown?.startIndex ?? 0) - 1 : (shown?.endIndex ?? rowCount - 1) + 1;
}

/** Whether a row holds an added or removed line. */
function changed(row: Row): boolean {
  return row.kind !== "hunk" && [row.old, row.new].some((c) => c !== null && c.change !== "context");
}

/** The rows that start a change, a run of added and removed lines, in order. O(rows), once per layout. */
export function changeStarts(rows: readonly Row[]): number[] {
  return rows.flatMap((row, i) => (changed(row) && !(i > 0 && changed(rows[i - 1]!)) ? [i] : []));
}

/**
 * The entry of `sorted` past `from` going `step`: the first above it, or going
 * back the last below it, so from inside a change ↑ reaches its own start
 * first. O(log entries).
 */
export function nextIn(sorted: readonly number[], from: number, step: 1 | -1): number | null {
  // The first entry above `from`.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= from) lo = mid + 1;
    else hi = mid;
  }
  const at = step === 1 ? lo : sorted[lo - 1] === from ? lo - 2 : lo - 1;
  return sorted[at] ?? null;
}

/**
 * The first row past `from` going `step` whose line can take a comment, found
 * in `lines` (`lineRows`), and that line, preferring `side`. O(log rows).
 */
export function lineAfter(
  rows: readonly Row[],
  lines: readonly number[],
  from: number,
  step: 1 | -1,
  side?: Side,
): { row: number; line: Cell } | null {
  const row = nextIn(lines, from, step);
  const line = row === null ? undefined : lineOf(rows[row]!, side);
  return row === null || !line ? null : { row, line };
}
