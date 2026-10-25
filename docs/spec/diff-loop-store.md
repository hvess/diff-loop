# diff-loop-store

The `ReviewStore` adapter: a file per branch in each project's common git directory, with the projects that hold one listed in the app's data directory.

**Status:** active — first version landed.
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

## Decisions

1. **A file is kept whole** (`file.rs`): every change holds the lock
   beside it (`<file>.lock`), and every write goes to `<file>.next` and is
   renamed over it. Reads take no lock. A file of another version, or
   that does not parse, is reported and never overwritten, nor removed.
2. **A branch's file name** (`name.rs`): `%` written `%25`, `/` written
   `%2F`, then `.json`; a name that does not decode is not a review file,
   so locks and writes in progress are never read as one.
3. **A file names its branch,** and a file whose branch is not the one
   asked for holds none of its review: where names ignore case, `Fix` and
   `fix` share a file.
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

## Pitfalls

- `Path::with_extension` replaces part of a branch named `v1.2`; a lock
  or a write in progress is named by appending (`file::beside`).

## Progress (2026-10-25, first version)

Step 1 landed: `FileReviews` replaces the app's `JsonReviews`
(`app/src-tauri/src/reviews.rs`, removed), and `reviews.json` is no
longer read (ADR 0030 §7).
