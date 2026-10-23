// What the bottom bar says of how much is left and of the last round (diff-loop-app.md Decision 35).
import type { Strip, StripPart } from "./round";

/**
 * The bar's progress: files not yet viewed, then the changed lines in
 * viewed files out of all; no second part when no file has a changed line.
 */
export function progressText(left: number, reviewed: number, total: number): [string, string] {
  const title = left === 0 ? "All files viewed" : `${left} ${left === 1 ? "file" : "files"} left`;
  if (total === 0) return [title, ""];
  const lines = `${total} ${total === 1 ? "line" : "lines"}`;
  if (reviewed === 0) return [title, `${lines} to review`];
  // Counted up, as the ring fills.
  return [title, `${reviewed === total ? lines : `${reviewed} of ${lines}`} reviewed`];
}

/**
 * The bar's two lines. While a round's answer shows (the agent's work changed or left its comments),
 * the round is the title and its counts the detail; otherwise what is left, then where the round stands.
 */
export function barLines(
  progress: [string, string],
  strip: Strip,
): { title: string; detail: string[]; parts: StripPart[] } {
  if (strip.stage === "answered" && strip.parts.length > 0) {
    return { title: strip.title, detail: [strip.meta].filter(Boolean), parts: strip.parts };
  }
  const [title, lines] = progress;
  // Mid-line, "Nothing sent yet" reads as the rest of the sentence.
  const round = strip.stage === "none" ? [strip.meta, strip.title.toLowerCase()] : [strip.title, strip.meta];
  return { title, detail: [lines, ...round].filter(Boolean), parts: [] };
}
