# 0017 — A round on the uncommitted changes follows a commit on top

**Status:** accepted, 2026-10-16; superseded by ADR 0030
**Amends:** ADR 0015 §8 (where a sent comment is judged)
**Affects:** `docs/spec/diff-loop-core.md` Decision 14;
`docs/spec/diff-loop-app.md` step 5 and Decision 16; `crates/core/src/anchor.rs`
(`Sent::judged_at`), `crates/core/src/rounds.rs` (`round_to_follow`);
`app/src-tauri/src/lib.rs` (the `round_to_follow` command);
`app/src/store.ts` (the banner's `action`); the `ux`
skill's "Settled wording"; open-tasks 18, closed

## Context

With the base at Uncommitted changes, the diff is the files on disk
against `HEAD`. A coding agent often commits its work when it is done:
`HEAD` moves to that commit and the diff empties, so every comment sent
in the round read as removed (ADR 0015, Consequences; open-tasks 18).
The comments were judged against changes they were never sent on: the
uncommitted changes at one commit are not those at another. The
developer asked for every open task to be fixed, 2026-10-16.

## Decision

1. **Uncommitted changes are judged at the commit they were sent on.**
   A comment sent against them (`Sent::place`'s base `Uncommitted`) is
   judged only while `HEAD` is still `Sent::commit`, or while the base
   is that commit by name (`Base::Ref`, its full id), on the same branch
   (`Sent::judged_at`; amended by ADR 0021 §2: or a short id of seven or
   more hex digits). Anywhere else its judgement is suspended, as
   under another base (ADR 0015 §8): it is found by its code and shows
   no verdict, so a commit never makes it read as removed.
2. **A commit on top is followed.** When a load on the uncommitted
   changes finds `HEAD` moved forward since the load before it, also on
   them (a reviewer who has just chosen them stays on them), from a
   commit an open comment was sent against them on (`round_to_follow`,
   asked of the core), the window compares with that commit instead,
   so the agent's commit and anything still uncommitted show as one
   diff, and the round is judged against it. The banner says so: "The
   branch moved: 1 new commit · showing changes since round 3
   (a1f3c9e)", naming the commit the base picker shows, and
   offers "Show uncommitted changes", which goes back, in place of
   "Show what changed", which it already shows. The newest such round is
   followed; a rewritten branch, a switched one, or a round with no open
   comment is not, nor a commit made while the window was closed: the
   first load has no load before it to have moved from, and the
   reviewer compares with the round's commit through the base picker.
   (Amended by ADR 0021: on opening, the newest round's commit stands in
   for the load before, and a short id names the commit too. Amended by
   ADR 0022: a later commit while following keeps the follow.)
   A base or repository the reviewer picked while the move was looked
   into, or while the follow loaded, is kept, and gets no banner; nor
   does a follow whose load failed, which reports its problem instead.
3. **A commit named in full (40 or 64 hex digits) shows as its short id** in the base picker
   and wherever the window names the base ("vs a1f3c9e"); the
   instructions name it as given.

## Consequences

- The reviewer goes back to the uncommitted changes alone through the
  banner or the base picker; their comments then wait, unjudged, as
  under any other base.
- "Show what changed" on a moved branch's banner compares with the
  previous `HEAD` by its full id, so a round sent at that commit is
  judged there too.
- A commit made by the reviewer on top of their own sent round is
  followed the same way: the window cannot tell who committed.
