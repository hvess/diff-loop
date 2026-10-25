# 0036 — Comments, questions and suggestions

**Status:** accepted, 2026-10-25; §1 amended by ADR 0037
**Amends:** ADR 0015 §6 (the instructions: what is new, then what is still open); ADR 0032 §1 (what the agent's note says) and §2 (what waits on the reviewer)
**Affects:** `docs/spec/diff-loop-core.md`, `docs/spec/diff-loop-app.md`, `docs/spec/diff-loop-mcp.md`, `docs/spec/diff-loop-store.md`; `crates/core` (`Comment::question`, `Kind`, `instructions`), `crates/mcp` (the tools' descriptions); `app/src` (the composer, the comment card and list, the round strip, the comment count, the preview's subtitle); the canvas's 3c, 3d, 3f, 4a, 4c and 5c

## Context

Every comment asked the agent for a change, with suggested code as its
strongest form. The developer wanted the reviewer able to ask the agent a
question too, answered rather than acted on, and the three told apart in
what is copied (2026-10-25), and had the canvas redrawn so.

## Decision

1. **A comment is one of three kinds**: a comment, a change to make; a
   question, to answer without changing code; a suggestion, code to put
   in the lines' place, with an optional why. The review file keeps a
   question as `"question": true` on the comment; a suggestion is a
   comment holding suggested code, as before; one saved before this
   reads as no question (`#[serde(default)]`). The core reads the kind
   (`Comment::kind`); the front end repeats that one test (`askOf`). The
   reviewer picks the kind in the composer's segmented control,
   Comment first; its main button says what it saves: Comment, Ask
   Question, Suggest Change. A sent comment keeps its kind.
2. **The agent answers a question as it resolves a comment** (ADR 0032
   §1): through `resolve_comment` or the review file, its note the
   answer. The answer waits on the reviewer, as a resolved comment does:
   shown as "Answered by agent" with the note as "Agent: …", marked
   answered with Mark Answered (R), or replied to, which edits the
   question and reopens it. Changing a comment's kind edits it, so an
   agent's mark on it goes, as a change to its text does. The round strip counts them apart ("1
   answered, to read"), and the comment count says "to read" beside "to
   accept". Every kind keeps the plain dot on its margin note and list
   row; the list names a question or a suggestion after its place.
3. **The instructions have a numbered section per kind** with one
   instruction each: "Address these comments" (change the code), "Answer
   these questions" (change no code), "Implement these suggestions" (as
   written, or say why not), a kind with nothing new left out and the
   rest numbered on; then "Still open", each item there saying a
   question's or a suggestion's kind; then "When you're done", naming the
   review file and how to mark each one resolved. The first line counts
   them: "Review of agent/x (compared with main): 2 comments, 1 question
   and 1 suggestion."

All the developer's calls, 2026-10-25.

## Consequences

- A review file written now can be read by an older build, which ignores
  `question` and would copy a question as a comment; no release has
  shipped the review file yet (ADR 0031 §1).
- An agent reading the instructions or `get_review` sees what each item
  asks before it acts, and answers a question in the note it already
  writes.
