# 0021 — A commit made while the window was closed is followed

**Status:** accepted, 2026-10-16
**Amends:** ADR 0017 §1 (the commit named by its full id) and §2 (a
commit made while the window was closed is not followed)
**Affects:** `crates/core/src/anchor.rs` (`names`), `app/src/store.ts`
(`followSinceOpened`); open-tasks 20, closed

## Context

ADR 0017 follows a commit on top of a round sent against the
uncommitted changes only when a load sees `HEAD` move since the load
before it. Opened after such a commit, the window had no load before,
so the round's comments waited unjudged; and the base picker, which
names the round's commit by its short id, could not bring the judgement
back, since a round was judged only under its commit's full id
(open-tasks 20). The developer asked for every open task to be fixed,
2026-10-16.

## Decision

1. **On opening, the newest round's commit stands in for the load
   before** (`followSinceOpened`): when `HEAD` has moved forward from it,
   the window follows as ADR 0017 §2 does, asking the core which round
   (`round_to_follow`), with the same banner. When it has not moved, or
   moved by a rewrite, nothing is said: the first load has no context
   to have changed.
2. **A commit is named in full or by a short id of seven or more hex
   digits** (`names`), so comparing with the commit the window shows,
   "vs a1f3c9e", judges the round too.

## Consequences

- A round sent before quitting, then committed on by the agent, opens
  followed and judged.
- A short id that matches the round's commit by prefix is taken as that
  commit; git would refuse an ambiguous one as a base before any
  judgement.
