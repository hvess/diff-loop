// What a comment is in the loop (ADR 0015): read off the fields the core keeps, never stored twice.
import type { Comment } from "./bindings/Comment";
import type { Verdict } from "./bindings/Verdict";

/** How a comment is drawn: its rail's and dot's tone (`toneOf`), its mark. Resolved comments are told apart by `resolved`. */
export type Kind = "draft" | "sent" | "changed" | "reopened" | "lost" | "outdated";

/** Whether the comment was edited since it was sent: the one comparison of the fields the core keeps, as its `Comment::reopened` makes it for the instructions. */
export function reopened(c: Comment): boolean {
  return c.sent !== null && (c.sent.text !== c.text || c.sent.suggestion !== c.suggestion);
}

/** The verdict the last load gave a sent comment, while it is judged at all. */
export function verdictOf(c: Comment): Verdict | null {
  return c.sent?.verdict ?? null;
}

/** Whether the sent code is no longer as sent: other code, nothing, or the suggestion in its place. */
export function changed(c: Comment): boolean {
  const v = verdictOf(c);
  return v === "changed" || v === "removed" || v === "applied";
}

export function kindOf(c: Comment): Kind {
  if (c.state === "lost") return "lost";
  if (c.sent === null) return c.state === "outdated" ? "outdated" : "draft";
  if (reopened(c)) return c.state === "outdated" ? "outdated" : "reopened";
  // A sent comment whose file left the diff where it is judged is outdated with a verdict: its code was removed.
  if (changed(c)) return "changed";
  return c.state === "outdated" ? "outdated" : "sent";
}

/** Whether an open comment is one the diff shown does not hold: the count's and the banner's "not in this diff". */
export function notInDiff(c: Comment): boolean {
  return c.resolved === null && kindOf(c) === "outdated";
}

/** Whether the agent resolved the comment and it waits on the reviewer to accept it or reopen it (ADR 0032 §2). */
export function awaitsReviewer(c: Comment): boolean {
  return c.resolved === "byAgent";
}

/** Whether the comment can be shown on its lines: a rail and margin note, a card, a stop for N / P. One the agent resolved stays there until accepted. */
export function hasCard(c: Comment): boolean {
  return c.state === "current" && (c.resolved === null || awaitsReviewer(c));
}

/** Whether the comment is still open: it is copied, counted and judged. */
export function open(c: Comment): boolean {
  return c.resolved === null;
}

/** Whether R can resolve or unresolve the comment: a draft never sent would only vanish from the copy (ADR 0015 §4); one already resolved, the agent's included, sent or not, R accepts or unresolves (ADR 0032 §2). */
export function resolvable(c: Comment): boolean {
  return c.sent !== null || c.resolved !== null;
}

/**
 * The tone a comment's rail, tick and list dot take: the accent for one the reviewer holds (a draft, or
 * reopened), amber once its code changed, grey once sent or set aside (the canvas's `.rail.sent`, `.rail.changed`).
 */
export function toneOf(c: Comment): "" | "sent" | "changed" {
  // Amber, as changed code is: the agent's word waits on the reviewer.
  if (awaitsReviewer(c)) return "changed";
  if (c.resolved !== null) return "sent";
  switch (kindOf(c)) {
    case "draft":
    case "reopened":
      return "";
    case "changed":
      return "changed";
    case "sent":
    case "lost":
    case "outdated":
      return "sent";
  }
}

/** The list entry's mark; empty for a draft. */
export function markOf(c: Comment): string {
  if (c.resolved === "suggestionApplied") return "Resolved · suggestion applied";
  if (awaitsReviewer(c)) return "Resolved by agent";
  if (c.resolved !== null) return "Resolved";
  switch (kindOf(c)) {
    case "draft":
      return "";
    case "sent":
      return "Sent";
    case "changed":
      return "Changed";
    case "reopened":
      return "Reopened";
    case "lost":
      return "Code gone";
    case "outdated":
      return "Not in this diff";
  }
}

/** The card's footer for a sent comment: what became of its code. */
export function footOf(c: Comment): string {
  switch (verdictOf(c)) {
    case "untouched":
      return "Untouched since sent";
    case "nearbyChanged":
      return "Untouched since sent · nearby lines changed";
    case "changed":
      // The canvas's words for the card that most needs the reviewer (5a), naming the button the card shows (5b).
      return `The code changed after you sent this. ${awaitsReviewer(c) ? "Accept" : "Resolve"} it if the change answers you.`;
    case "removed":
      return "Code removed since sent";
    case "applied":
      return "Suggestion applied";
    case null:
      return "";
  }
}
