// What the round strip and the preview's subtitle say of the loop (ADR 0015).
import type { Comment } from "./bindings/Comment";
import type { Round } from "./bindings/Round";
import { when } from "./format";
import { answered, changed, KINDS, open as isOpen, reopened, toAccept } from "./lifecycle";
import { type CommentFilter, inFilter } from "./store";

/** What the strip says of the last round: its title, its counts, and what goes at the right. */
export function roundStrip(
  rounds: Round[],
  comments: Comment[],
  autoResolved: number,
  now: number,
): Strip {
  const last = rounds.at(-1);
  if (!last) {
    const drafts = comments.filter((c) => c.sent === null && c.resolved === null).length;
    return { title: "Nothing sent yet", stage: "none", parts: [], meta: drafts > 0 ? `${drafts} ${drafts === 1 ? "draft" : "drafts"}` : "" };
  }
  const sent = comments.filter((c) => c.sent?.round === last.number);
  // A reopened comment is the reviewer's again: neither changed nor untouched until sent once more.
  const open = sent.filter((c) => c.resolved === null && !reopened(c));
  const changedN = open.filter(changed).length;
  const untouchedN = open.filter((c) => inFilter(c, "untouched")).length;
  // What the agent says it fixed, or answered, waits on the reviewer, from any round or none, as the `byAgent` and
  // `answered` filters step through them (ADR 0032 §2, ADR 0036 §2).
  const answeredN = comments.filter(answered).length;
  const byAgentN = comments.filter(toAccept).length;
  // Until the agent's work shows, the round reads as what was just sent.
  if (changedN === 0 && autoResolved === 0 && byAgentN === 0 && answeredN === 0 && open.length === sent.length) {
    const n = sent.length;
    return {
      title: `Round ${last.number} sent`,
      stage: "sent",
      parts: [{ filter: null, text: `${n} ${n === 1 ? "comment" : "comments"}` }],
      meta: when(last.at, now),
    };
  }
  const parts: StripPart[] = [];
  if (changedN > 0) parts.push({ filter: "changed", text: `${changedN} changed` });
  if (untouchedN > 0) parts.push({ filter: "untouched", text: `${untouchedN} untouched` });
  if (byAgentN > 0) parts.push({ filter: "byAgent", text: `${byAgentN} resolved by agent, to accept` });
  if (answeredN > 0) parts.push({ filter: "answered", text: `${answeredN} answered, to read` });
  if (autoResolved > 0) parts.push({ filter: null, text: `${autoResolved} resolved automatically` });
  return { title: `Round ${last.number}`, stage: "answered", parts, meta: "" };
}

/** One count in the strip; clicking one with a `filter` steps N / P through those comments. */
export type StripPart = { filter: CommentFilter; text: string };

/** The strip, at its stage: before any round, a round sent and unanswered, or answered once the agent's work shows. */
export type Strip = { title: string; stage: "none" | "sent" | "answered"; parts: StripPart[]; meta: string };


/** "2 comments · 1 question · 1 suggestion" before any round (the canvas's 4c); "3 new · 2 still open" once one was sent. */
export function previewSubtitle(comments: Comment[], rounds: number): string {
  const open = comments.filter(isOpen);
  if (rounds === 0) {
    const kinds = KINDS.map(({ kind }) => [kind, open.filter((c) => c.ask.kind === kind).length] as const)
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`);
    return kinds.length > 0 ? kinds.join(" · ") : "0 comments";
  }
  const fresh = open.filter((c) => c.sent === null || reopened(c)).length;
  return `${fresh} new · ${open.length - fresh} still open`;
}
