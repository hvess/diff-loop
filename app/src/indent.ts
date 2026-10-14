// Code as "Suggest code" shows it: without the indent its lines share (diff-loop-app.md Decision 26).

/**
 * `lines` without the leading whitespace every non-blank one shares, blank
 * lines then emptied; `lines` as they are when they share none.
 */
export function dedent(lines: string[]): string[] {
  const lead = (l: string) => l.length - l.trimStart().length;
  // A reduce, not Math.min(...): a range the size of an added file would pass too many arguments.
  const indent = lines.reduce((least, l) => (l.trim() === "" ? least : Math.min(least, lead(l))), Infinity);
  if (!Number.isFinite(indent) || indent === 0) return lines;
  return lines.map((l) => (l.trim() === "" ? "" : l.slice(indent)));
}
