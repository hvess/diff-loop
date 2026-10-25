# diff-loop-store

The `ReviewStore` adapter: a file per branch in each project's common git directory, with the projects that hold one listed in the app's data directory.

**Status:** active — the review file and the agent's marks landed.
**Scope:** `crates/store`. Excludes what a review holds (the core) and when the app saves (`docs/spec/diff-loop-app.md`).
**Owner:** Maximilian
**Last Updated:** 2026-10-25

## Why

ADR 0030 moves reviews out of the app's data directory into the projects
they belong to, so the MCP server (`docs/spec/diff-loop-mcp.md`) and the
app share them; ADR 0031 §3 makes the store a crate both can depend on.

## Steps

1. A review per branch at `<common git dir>/diff-loop/reviews/<name>.json`,
   and `projects.json` listing the projects that hold one (ADR 0030 §1,
   ADR 0031 §1 and §2) — done 2026-10-25.
2. The agent's marks (ADR 0032): a save keeps marks the window has not
   seen, `change` writes in one locked step, `location` names a review's
   file and `watch` follows it (Decisions 7 to 9) — done 2026-10-25.

## Decisions

1. **A file is kept whole** (`file.rs`): every change holds the lock
   beside it (`<file>.lock`), and every write goes to `<file>.next` and is
   renamed over it. Reads take no lock. A file of another version, or
   that does not parse, is reported and never overwritten, nor removed.
   A comment's `question` (ADR 0036 §1) reads as false where a file
   written before it has none, so the format stays at version 1.
2. **A branch's file name** (`name.rs`): `%` written `%25`, `/` written
   `%2F`, then `.json`; a name that does not decode is not a review file,
   so locks and writes in progress are never read as one.
3. **A file names its branch,** and a file whose branch is not the one
   asked for holds none of its review: where names ignore case, `Fix` and
   `fix` share a file. A save replaces it whichever branch it holds, so
   the last save wins and the other branch's review is lost. The
   developer's call, 2026-10-25.
4. **A save never makes a git directory.** A review saved for a project
   that is gone fails; an empty one has nothing to remove and succeeds.
   Either drops the project from the list.
5. **The list changes after the review's file, under its own lock**
   (`Projects::note`): whether the project still holds a review is asked
   under that lock, so two saves in one project, one emptying it and one
   filling it, leave it listed. The projects to drop as gone are found
   before the lock.
6. **A listing leaves out what it cannot read** (ADR 0031 §5): a review
   folder or file that cannot be read is skipped in `kept`; `saved`
   reports it. Only an unreadable `projects.json` fails the listing.
7. **A save keeps the agent's marks it has not seen** (ADR 0032 §3):
   under the lock, the review written takes in each comment the file
   holds resolved by the agent while the window's copy is open and
   unedited (`SavedReview::keeping_agent_marks`).
8. **A watch hears its review's file by name** (`touches`): the folder,
   made if missing (never the git directory, Decision 4), is watched; reads do not count, and macOS reports
   paths with links resolved, so the name alone is compared.
9. **Every write is one locked step** (`FileReviews::replace`): `save`
   and `change` read what is kept and write in its place under the lock,
   so the MCP server's resolve and the app's save never lose each other's
   work.

## Pitfalls

- `Path::with_extension` replaces part of a branch named `v1.2`; a lock
  or a write in progress is named by appending (`file::beside`).

## Progress (2026-10-25, the agent's marks)

A save keeps the agent's unseen marks (Decision 7), `location` names a
review's file, and `watch` follows it (Decision 8).

## Progress (2026-10-25, first version)

Step 1 landed: `FileReviews` replaces the app's `JsonReviews`
(`app/src-tauri/src/reviews.rs`, removed), and `reviews.json` is no
longer read (ADR 0030 §7).
