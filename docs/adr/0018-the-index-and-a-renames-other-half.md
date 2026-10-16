# 0018 — A change to the index, and a rename's other half

**Status:** accepted, 2026-10-16
**Amends:** ADR 0005 §1 (git's own files name nothing) and §3 (what an
update reads); ADR 0014, Consequences (both waited for a full read)
**Affects:** `crates/git/src/watch.rs`, `crates/git/src/lib.rs`
(`Repository::watch`); `crates/core/src/update.rs` (`halves`);
`docs/spec/diff-loop-git.md` Decision 6; `docs/spec/diff-loop-core.md`
Decision 12; open-tasks 10, closed

## Context

While a watch runs, a load reads only what the watch saw touched
(ADR 0005). Two changes reach no touched path, and showed only at the
next full read (ADR 0005, Consequences; open-tasks 10): a change to the
index alone (`git rm --cached`), and a rename into a path the watch did
not touch, read as an addition and a deletion. The developer asked for
every open task to be fixed, 2026-10-16.

## Decision

1. **A change to the working tree's index touches everything.** The
   watch knows the index's path (`git rev-parse --git-path index`) and
   reports `Touched::Everything` when an event names it; git's other
   files still name nothing. The app's own git calls run with
   `GIT_OPTIONAL_LOCKS=0` and never write the index, so its reads cannot
   set off a load.
2. **A new addition or deletion is read with its possible other half.**
   When the touched paths read again show a file newly added, the
   deletions already in the review are read again with them, and the
   additions when they show one newly deleted (`update::halves`); git
   pairs a staged addition with a deletion as a rename when it reads them
   together. A file added or deleted before and saved again asks for
   nothing. Past `MOST_PATHS` in all, everything is read. An untracked
   file is listed beside the diff and never pairs, in a full read as in
   this one; `git add` and `git mv` reach §1.

## Consequences

- Staging, unstaging or committing by another program loads everything
  once, as a commit already did through its moved snapshot.
- A program that refreshes the index often (an editor's git panel)
  costs a full read each time it writes it.
- A file newly created, or newly deleted, while the review holds many of
  the opposite kind costs a second partial read, once.
