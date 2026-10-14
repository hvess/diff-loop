# diff-loop-core

The domain: what changed on a checkout, the files by role, review comments, and the instructions they become.

**Status:** active — first version landed.
**Scope:** `crates/core`. Excludes reading git (`diff-loop-git.md`) and the UI (`diff-loop-app.md`).
**Owner:** Maximilian
**Last Updated:** 2026-10-14

## Why

The design's flows reduce to four pieces of logic that must not depend on
git or Tauri: which base to start from, which role a file plays, keeping a
comment on its code as the agent changes the checkout, and writing the
review as instructions. Each is a pure function tested here.

## Steps

1. Types and the `Repository` port (`repository.rs`, `diff.rs`, `base.rs`) — done 2026-10-13.
2. `default_base` — done 2026-10-13.
3. `Role::of` and `group` — done 2026-10-13.
4. `reanchor` — done 2026-10-13.
5. `instructions` — done 2026-10-13.
6. `open` and `load`, composing the above over a `Repository` — done 2026-10-13.
7. `lines`: a line range of either side of a file, for the unchanged lines a diff leaves out — done 2026-10-13.
8. The `ReviewStore` port and `SavedReview` (ADR 0004) — done 2026-10-13.
9. `update`, and `load` since the last load: read only what was touched (ADR 0005) — done 2026-10-13.
10. `BaseRef::behind` and `Repository::uncommitted_files`, for the base picker — done 2026-10-13.

## Decisions

1. **Line numbers are 1-based and per side.** A `Line` is an enum, so a
   removed line cannot carry a new-side number.
2. **The default base** is the first that exists of: the remote's
   default branch (local copy first), `main`, `master`, `origin/main`,
   `origin/master`. The checked-out branch counts as existing; when it is
   the one found, or none exists, only uncommitted changes are compared.
3. **A line comment's range is its code.** `Target::Lines` holds a start
   and the commented lines; its last line is `Target::end`, so a range
   cannot disagree with its code. The front end keeps a range inside one
   hunk (diff-loop-app Decision 6).
4. **A comment stays on its code, not its line number.** `reanchor` keeps
   it where its saved `code` still is, moves it to the nearest run of
   consecutive lines that match, or marks it outdated. An outdated comment
   keeps its last position and code, and every load looks for it again:
   found, it is current. Whether an outdated comment is deleted or only
   hidden is the front end's, which knows what the last load compared
   (diff-loop-app Decision 16).
5. **Roles come from the path**, and binary content makes a file an
   asset, whatever its path. Order: source, tests, config, docs, assets.
6. **Instructions** group comments by file in the order given (the front
   end passes sidebar order); within a file, whole-file comments come
   first, then removed-line comments, then the rest, each by line. They
   quote the first non-blank line of code cut to 60 characters, and
   dedent suggestions into a fenced block named for the file's language;
   a comment with no text (suggested code alone) has no `: text`.
   `Format::Markdown` only adds `###` to headings.
7. **`open` and `load` take any `Repository`, sized or not**, so the app
   can hold its adapter as `dyn Repository`.
8. **`load` returns only what the caller lacks.** Each file carries a
   signature (a hash of its `FileDiff`, valid within one run); a file
   whose signature matches one in `known` comes back as
   `ReviewFile::Unchanged`.
9. **The port can watch** (`Repository::watch`, ADR 0002): an adapter
   reports what it touched (ADR 0005 §1).
10. **`lines` reads through `Repository::blob`**, so the port needs no
    new method; it splits as `str::lines` does, like the diff (Pitfalls).
    A range past the file's end returns what exists.

11. **A review is kept per working tree** (`ReviewStore`, ADR 0004 §1):
    its comments and note, whatever the base. An empty `SavedReview`
    removes the entry.

12. **`load` since the last load reads only what was touched**
    (`update`, ADR 0005 §3), by their top-level directories past
    `MOST_PATHS`, and everything when the snapshot moved or the watch lost
    track; it then takes no fingerprint, and keeps the signatures of files
    it did not read again. `Loaded` is opaque: only `load` makes one.

13. **"Behind" is `git status`'s sense:** `BaseRef::behind` counts the
    ref's commits the checkout lacks. The design shows only
    "behind". The developer's call, 2026-10-13.

## Pitfalls

- `Line` text excludes the line ending, and git's `\r` is stripped with
  it (`str::lines`); comparisons in `reanchor` rely on both sides being
  read the same way.

## Progress (2026-10-13, comments deleted when their code changes)

An outdated comment is looked for again on every load (Decision 4).

## Progress (2026-10-13, the base picker's notes)

Step 10 landed.

## Progress (2026-10-13, reading only what was touched)

Step 9 landed (ADR 0005).

## Progress (2026-10-13, reviews kept between runs)

Step 8 landed with the app's `JsonReviews` adapter.

## Progress (2026-10-13, expanding unchanged lines)

Step 7 landed with the app's "Show N unchanged lines".

## Progress (2026-10-13, first version)

The crate and its tests landed with the Tauri app and the git adapter.
