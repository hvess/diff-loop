# diff-loop-core

The domain: what changed on a checkout, the files by role, review comments, and the instructions they become.

**Status:** active — first version landed.
**Scope:** `crates/core`. Excludes reading git (`diff-loop-git.md`) and the UI (`diff-loop-app.md`).
**Owner:** Maximilian
**Last Updated:** 2026-10-13

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
   keeps its old position and code until the reviewer resolves it or keeps
   it (which re-snapshots the code).
5. **Roles come from the path**, and binary content makes a file an
   asset, whatever its path. Order: source, tests, config, docs, assets.
6. **Instructions** group comments by file in the order given (the front
   end passes sidebar order); within a file, whole-file comments come
   first, then removed-line comments, then the rest, each by line. They
   quote the first non-blank line of code cut to 60 characters, and
   dedent suggestions into a fenced block named for the file's language.
   `Format::Markdown` only adds `###` to headings.
7. **`open` and `load` take any `Repository`, sized or not**, so the app
   can hold its adapter as `dyn Repository`.
8. **`load` returns only what the caller lacks.** Each file carries a
   signature (a hash of its `FileDiff`, valid within one run); a file
   whose signature matches one in `known` comes back as
   `ReviewFile::Unchanged`.
9. **The port can watch** (`Repository::watch`, ADR 0002): an adapter
   reports possible changes; the fingerprint decides.
10. **`lines` reads through `Repository::blob`**, so the port needs no
    new method; it splits as `str::lines` does, like the diff (Pitfalls).
    A range past the file's end returns what exists.

## Pitfalls

- `Line` text excludes the line ending, and git's `\r` is stripped with
  it (`str::lines`); comparisons in `reanchor` rely on both sides being
  read the same way.

## Progress (2026-10-13, expanding unchanged lines)

Step 7 landed with the app's "Show N unchanged lines".

## Progress (2026-10-13, first version)

The crate and its tests landed with the Tauri app and the git adapter.
