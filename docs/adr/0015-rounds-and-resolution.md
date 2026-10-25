# 0015 — Rounds, and comments resolved rather than removed

**Status:** accepted, 2026-10-15 (proposed earlier the same day; the
design followed with a component sheet and six red-pen notes, each of
which the developer answered, below)
**Superseded in part:** §3, §8 and §9 by ADR 0030, which amends §1 and §4
**Supersedes:** diff-loop-app Decision 16 (a comment whose code changed is
removed, with Undo)
**Amends:** ADR 0004 §1, §3 and §4 (what a saved review holds, and the
format's version); ADR 0005 §4 (a load's effect on comments)
**Affects:** `docs/spec/diff-loop-core.md` Decisions 4, 6 and 11,
`docs/spec/diff-loop-app.md` Decisions 16 and 25; `crates/core`
(`anchor.rs`, `code.rs`, `rounds.rs`, `saved.rs`, `instructions.rs`),
`app/src-tauri/src/reviews.rs` and `lib.rs` (`end_round`), `app/src`
(`store.ts`, `lifecycle.ts`, `round.ts`, the comment list, card and pin);
the `ux` skill's gate and settled wording

## Context

A load under the same base and branch that no longer found a comment's
code removed the comment, on the reading that the agent had addressed it,
and offered Undo in a banner (Decision 16). Three things made that
unreliable (2026-10-15):

- The removal compared the previous load with this one, so what the
  watch did or did not see (ADR 0005; open-tasks 10, closed by ADR 0018)
  decided *whether* a
  comment went, not only *when* the window caught up.
- Changed code is not an addressed comment. A reformat, a rename or a
  file the agent had half written took the comment; a comment addressed
  somewhere else ("move this into utils") kept its code and stayed open,
  indistinguishable from one the agent skipped.
- Removing on a guess costs the reviewer's thought when wrong, where
  keeping on a guess costs one key. Undo existed to pay for that.

The app is a loop: write comments, copy instructions, the agent works,
check. Comments had no state that followed the loop. The developer chose
the model below, 2026-10-15, each point asked with a recommendation and
taken as recommended; the design's red-pen notes 01 to 06 were put to the
developer the same day and each taken as recommended (§2, §3, §4 and §6
say where).

## Decision

1. **Copying the instructions ends a round.** Every comment the copy
   included becomes *sent*; the round records when, the base and branch,
   the checkout's commit, and the Markdown as copied (a kept preview edit
   included); each sent comment records the code it was on with up to
   three lines either side of it, its text and suggestion as
   sent, and its round. There is no other way to send. (Amended by ADR 0030 §6: Finish Round ends it; withdrawn by ADR 0032 §5.) Until the next
   load changes something, the Copied popover stays and offers "Not
   sent", which returns the review to what it was before the copy
   (red-pen note 02); dismissing the popover, or writing, editing,
   deleting or resolving a comment, ends the offer.
2. **A load never removes a comment.** A *draft* (not yet sent) whose
   code a load cannot find, under the base and branch it was last seen on
   (`Comment::place`), is *lost*: it keeps its place in the list with its
   quoted code, draws no pin, is skipped by N / P, and offers Re-place
   (choose a line in the selected file, which rewrites its target and
   code, with Undo) and Delete. Copied while lost, it is sent and
   outdated, since lost is a draft's state. It is still copied into the instructions,
   as "Code no longer in the diff, was `…`". Under another base or branch
   it is outdated, as before.
3. **A sent comment is judged against the code it was sent on,** never
   against the previous load. Its code found, with its context, it is
   *untouched*; found with its context changed, *untouched · nearby lines
   changed* (note 01); its context found with other code between, it is
   *changed*, and its target becomes that code, so the card can show the
   sent code and the code now in one block and say where the lines went,
   "Lines 21–24 → line 23" (note 05); with nothing between, or neither
   code nor context, *removed*, its pin as near its last known line as the
   diff shows. The judgement is made at every load from state the comment
   already carries, so a watch event the platform lost delays it and
   cannot alter it. Untouched shows from the moment of sending; it is a
   count, not a verdict. A sent comment whose file left the diff where it
   was sent is removed and outdated: it has no line for a pin, the list
   draws it as changed and offers Resolve.
4. **Resolution is the reviewer's.** (Amended by ADR 0032 §2: the agent
   may resolve a comment too, and the reviewer accepts it.) `R` resolves the comment under the
   open card, which closes it, and `R` again unresolves that comment and
   opens its card, until another comment is shown; on a draft never sent it does
   nothing, since a resolved draft would only vanish from every copy
   (note 03). One case resolves itself: a comment whose suggestion is now
   exactly in place, judged once on the way in, so an unresolved one is
   not resolved again while it stays applied (since ADR 0030 §5, never). The round strip says "N
   resolved automatically" after that load, and the Resolved section
   labels it "Resolved · suggestion applied" (note 06). "On the way in"
   is from another verdict the comment carried: a suggestion applied
   while the judgement was suspended (§8) does not resolve itself. A resolved comment
   leaves the live list for a collapsed "Resolved (n)" section, draws no
   pin, and is never copied again.
5. **Editing a sent comment reopens it:** it keeps its round, and the
   instructions render it under "Still: …" with the new text ("Still: see
   the suggested change." when only its suggestion changed); its card
   and the composer show what was sent.
6. **A copy includes everything unresolved:** drafts, reopened comments,
   and sent comments still open, the last under a "Still open" heading
   so the agent reads them as repeats, a changed one with "was L21–24", a
   removed one as "Code removed since sent". Nothing leaves a round
   but by the reviewer: resolving it, or deleting it from its card
   (⌘/Ctrl-Backspace). The list's "Clear all" is "Delete
   drafts", and the Copied popover offers no clearing: sent comments are
   the round's record (note 04).
7. **Whitespace alone is not a change.** `reanchor` compares lines with
   trailing whitespace trimmed and a run of leading whitespace counting
   only as present or absent (`code::same_code`); the same comparison
   decides changed and untouched (§3). Everything else is a change.
8. **Another base or branch suspends the judgement.** Comments go
   outdated and hidden as today (diff-loop-core Decision 4) until a load
   finds their code; changed and untouched are shown only while the base
   and branch are the ones the round was sent on (`Sent::place`), and a
   sent comment found elsewhere carries no verdict.
   (Amended by ADR 0017 §1: sent against the uncommitted changes, only
   while `HEAD` is still the commit it was sent at, or with that commit
   as the base.)
9. **Rounds persist per working tree** in `reviews.json`, version 2:
   `{"version": 2, "reviews": {"<root>": {"comments": [...],
   "rounds": [...]}}}`, each comment carrying where it was last seen
   (`place`), what it was sent on (`sent`) and how it was resolved
   (`resolved`, a plain string as `state` is). The last 20 rounds are kept; an older
   round drops with its resolved comments, and an open comment is never
   dropped by the bound. A version 1 file is read, its comments taken as
   drafts with no place (so never lost, only outdated, until a load sees
   them), and written back as version 2; a file of any other version, or
   that does not parse, is reported and never overwritten (ADR 0004 §3).
   The copy sends the core only the changed files the open comments are
   in (`end_round`, `RoundRequest::files`), from which it reads their
   context. A saved review read again after a failed read is merged by
   the core (`merge`): rounds copied meanwhile count on from the saved
   ones, their comments following, and the bound holds.
   (Amended by ADR 0020 §1: version 3, with when each tree was last
   seen. Amended by ADR 0026 §1 and §8: per branch of a project, in
   version 4.)
10. **The Undo banner goes.** A banner announces only a context change:
    a switched branch, a moved or rewritten branch, and how many open
    comments are not in this diff. "The agent updated the code" and
    "addressed and removed" are no longer said. (Amended by ADR 0026 §3
    and §4: a branch switched in the worktree is another review, so this
    one falls back to its branch's commits and the banner says that; and
    a review shown again says where its branch went while away.)

## Consequences

- Nothing a reviewer writes is deleted by anything but the reviewer.
- The window can say what the agent skipped: "1 untouched" on a round
  is new information; "2 removed" was not.
- Detection precision becomes a latency question: ⌘/Ctrl-R and focus
  already catch what the watch misses (ADR 0014), and now that is all
  they need to catch.
- Three comment properties replace two: lifecycle (draft, sent,
  reopened, resolved; `app/src/lifecycle.ts` reads it off the fields),
  the anchor's state (current, outdated, lost) and, for a sent comment,
  its verdict (untouched, nearby changed, changed, removed, applied).
  Each has its look where a comment is drawn: the pin (ink for the
  reviewer's, paper for the agent's, a badge for changed or reopened),
  the card, the list entry, the round strip and the Resolved section.
- An earlier build reading a version 2 file reports it unreadable and
  leaves it alone (ADR 0004 §3); nothing is lost by running both.
- `reviews.json` grows by up to 20 rounds per tree, each with its
  Markdown; open-tasks 9's pruning concern grows with it (closed by
  ADR 0020).
- With the base at Uncommitted changes, a commit by the agent empties
  the diff: every sent comment reads as removed until the base is
  changed, where the judgement is suspended (§8). The developer has not
  been asked for a rule here; open task 18 (since 2026-10-16: ADR 0017
  judges such a round at its commit and follows a commit on top).
