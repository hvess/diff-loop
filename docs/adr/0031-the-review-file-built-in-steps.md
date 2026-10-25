# 0031 — The review file is built in steps, and the projects with one are listed

**Status:** accepted, 2026-10-25
**Amends:** ADR 0030 §2 (the format's first shape), §4 (the app watching the server's saves) and §7 (where the app finds every project's reviews)
**Affects:** `crates/store` (new, `docs/spec/diff-loop-store.md`); `crates/git/src/watch.rs`; `app/src-tauri/src/lib.rs` (`app/src-tauri/src/reviews.rs` removed); `crates/core/src/saved.rs` (`OWN_FOLDER`)

## Context

ADR 0030 §2 draws the review file with threads, comment states and round
snapshots, which exist only once `docs/spec/diff-loop-mcp.md`'s steps 2, 3
and 7 land; step 1 only moves reviews into each project. And the review
switcher and the welcome screen list every project's reviews (ADR 0026
§7), which a file per project cannot tell on its own. The developer chose
both answers, 2026-10-25.

## Decision

1. **The format grows with the steps, at version 1.** Step 1's file holds
   today's `SavedReview` (comments, rounds, base, seen) beside `version`
   and `branch`; each later step adds what ADR 0030 §2 draws. No release
   ships between the steps, so no file of an intermediate shape is kept
   anywhere that a later build must read. The developer's call, 2026-10-25.
2. **The projects that hold a review are listed in the app's data
   directory,** `projects.json`: `{"version": 1, "projects": [...]}`, each
   a common git directory. A save adds its project while it holds a
   review and drops it once it holds none, and drops every project whose
   git directory is gone; it changes the list under `projects.json.lock`.
   Reviews stay in their projects. The developer's call, 2026-10-25.
3. **The store is its own crate,** `diff-loop-store`, depending on the
   core alone, so the app and the MCP server share it. The developer's
   call, 2026-10-25.
4. **The watch ignores Diff Loop's own folder** (`OWN_FOLDER`): a burst
   that touched only files under `<common git dir>/diff-loop/` calls
   nothing, so a save does not reload the window that made it. The app
   does not watch the server's saves until `docs/spec/diff-loop-mcp.md`'s
   step 6 decides how.
5. **A listing leaves out a review it cannot read** (`ReviewStore::kept`):
   a damaged file in one project hides no other review. Opening that
   branch still reports it, and it is never overwritten. The developer's
   call, 2026-10-25.

## Consequences

- A project whose git directory is away (a share, a drive) leaves the
  list at the next save, and comes back when one of its reviews is next
  saved.
- `reviews.json` and its lock stay in the app-data directory, unread.
- Step 6 of `docs/spec/diff-loop-mcp.md`, which has the app see the MCP
  server's saves, needs its own way to tell them from the app's: §4 hides
  both.
