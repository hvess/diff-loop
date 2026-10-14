// Find in file: where a query matches the text the open file shows.
import { lineKey, type SplitRow, type UnifiedRow } from "./rows";

/** One match: the row it is in, the cell's `lineKey`, and its span in the cell's text. */
export type Match = { row: number; cell: string; from: number; to: number };

/** A match's span within its cell, and whether it is the current one. */
export type Mark = { from: number; to: number; current: boolean };

/** A run of a token's text, and the mark it is under, if any. */
export type Piece<T> = { token: T; content: string; mark: "match" | "current" | null };

/**
 * The matches of `query` in the cells `rows` show, ignoring case, in reading
 * order; a unified row shows one cell, a split row both sides. A cell whose
 * lower case has another length is not searched. O(text of the rows read):
 * every row, or the ascending row indexes in `only`; empty for an empty query.
 */
export function findIn(rows: readonly (UnifiedRow | SplitRow)[], query: string, only?: readonly number[]): Match[] {
  const q = query.toLowerCase();
  if (q === "") return [];
  const out: Match[] = [];
  const search = (i: number) => {
    const row = rows[i]!;
    if (row.kind === "hunk") return;
    const cells = row.kind === "line" ? [row.new ?? row.old] : [row.old, row.new];
    for (const cell of cells) {
      if (!cell) continue;
      const text = cell.text.toLowerCase();
      // A character whose lower case has another length would shift every span after it.
      if (text.length !== cell.text.length) continue;
      for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
        out.push({ row: i, cell: lineKey(cell.side, cell.no), from: at, to: at + q.length });
      }
    }
  };
  if (only) for (const i of only) search(i);
  else for (let i = 0; i < rows.length; i++) search(i);
  return out;
}

/** Per set of rows, what the queries typed on the way to the current one found, by query. */
const typed = new WeakMap<readonly (UnifiedRow | SplitRow)[], Map<string, Match[]>>();

/**
 * `findIn`, narrowed while typing. A query that extends one already searched
 * in the same rows can only match in a row that one matched, so only those
 * are read again; a query typed on the way here (Backspace) is not searched
 * again at all. Anything else reads every row once and starts a new chain.
 * The chain holds one entry per prefix of the query being typed.
 */
export function findTyped(rows: readonly (UnifiedRow | SplitRow)[], query: string): Match[] {
  const q = query.toLowerCase();
  let chain = typed.get(rows);
  const known = chain?.get(q);
  if (known) return known;
  // The longest query searched so far that this one extends.
  let base: Match[] | undefined;
  for (let n = q.length - 1; n > 0 && !base; n--) base = chain?.get(q.slice(0, n));
  if (!base || !chain) {
    chain = new Map();
    typed.set(rows, chain);
  }
  // Rows in order, each once: matches come in reading order.
  const matches = base ? findIn(rows, query, [...new Set(base.map((m) => m.row))]) : findIn(rows, query);
  // Only this query's prefixes stay: a branch typed after a Backspace replaces the old one.
  for (const key of chain.keys()) if (!q.startsWith(key)) chain.delete(key);
  chain.set(q, matches);
  return matches;
}

/** `tokens` cut where `marks` (in order, not overlapping) start and end. */
export function marked<T extends { content: string }>(tokens: readonly T[], marks: readonly Mark[]): Piece<T>[] {
  const out: Piece<T>[] = [];
  let offset = 0;
  let m = 0;
  for (const token of tokens) {
    const end = offset + token.content.length;
    let at = offset;
    while (at < end) {
      while (m < marks.length && marks[m]!.to <= at) m++;
      const mark = marks[m];
      if (!mark || mark.from >= end) {
        out.push({ token, content: token.content.slice(at - offset), mark: null });
        break;
      }
      if (mark.from > at) {
        out.push({ token, content: token.content.slice(at - offset, mark.from - offset), mark: null });
        at = mark.from;
      }
      const stop = Math.min(mark.to, end);
      out.push({ token, content: token.content.slice(at - offset, stop - offset), mark: mark.current ? "current" : "match" });
      at = stop;
    }
    offset = end;
  }
  return out;
}
