# 0022 — A follow outlives a later commit

**Status:** accepted, 2026-10-16; superseded by ADR 0030
**Amends:** ADR 0017 §2 (a follow is decided only on the uncommitted
changes)
**Affects:** `crates/core/src/anchor.rs` (`Sent::follows`),
`crates/core/src/rounds.rs` (`round_to_follow`), `app/src/store.ts`
(`following`, `keepFollowing`); `docs/spec/diff-loop-app.md` and
`docs/spec/diff-loop-core.md` Decision 16; open-tasks 21, closed

## Context

ADR 0017 §2 follows a commit on top of a round sent against the
uncommitted changes by comparing with the round's commit. A second
commit then arrived on that base, a commit by name, which ADR 0017 does
not follow from: the follow's banner and its way back gave way to a
plain "The branch moved" (open-tasks 21). The developer asked for every
open task to be fixed, 2026-10-16.

## Decision

1. **While the base follows a round, a later commit keeps it
   followed:** the banner says so, counted from the round's commit, and
   still offers the uncommitted changes. The core answers whether the
   round is still followed (`round_to_follow`, asked with the round's
   commit): on a base naming that commit, a round sent against the
   uncommitted changes there with an open comment.
2. **The follow ends** when the reviewer chooses another base, the
   branch is switched or rewritten, or the core names the round no more,
   its comments resolved; the plain banner says what moved.
3. **A base the reviewer picked is never followed from:** a follow
   starts only on the uncommitted changes (ADR 0017 §2), and a commit on
   a base naming the round's commit, but started from another, is not
   the round's. Only a follow under way is kept on a commit's base.

## Consequences

- An agent committing again and again on top of a round keeps the
  window on the round's commit, judging the round against all of it.
