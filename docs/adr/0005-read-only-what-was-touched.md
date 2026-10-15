# 0005 — Read only what the watch saw touched

**Status:** accepted, 2026-10-13
**Amends:** ADR 0002 §1 (the callback names what was touched) and §3 (a
watch event loads instead of taking a fingerprint)
**Affects:** open-tasks 7; `docs/spec/diff-loop-core.md`,
`docs/spec/diff-loop-git.md`, `docs/spec/diff-loop-app.md`

## Context

Each watch event took a fingerprint, a full `git diff`, and a change
reloaded the whole diff in Rust. A build writing ignored files, or an
agent editing one file in a large change, paid for the whole checkout
each time. The developer chose rebuilding per changed path, 2026-10-13.

## Decision

1. **The watch names what it touched** (`Repository::watch` calls
   `OnChange` with a `Touched`): working-tree paths relative to the root,
   or `Everything` when the platform lost events or a path is not UTF-8.
   Git's own files name nothing; an edited directory names nothing either,
   since its contents report themselves, while a created, removed or
   renamed one names itself (a folder moved in brings files that report
   nothing). Reading a file names nothing; closing one written to does.
   A git directory inside one already watched is not watched again.
2. **The port reads a subset** (`Repository::changes_in`): the changes
   at or under given paths, untracked files included, as literal
   pathspecs. None for no paths, with the snapshot.
3. **The core brings the last load up to date** (`update`): it reads the
   touched paths again, with both paths of any rename among them, and
   replaces what it held for them. Past 500 paths (`MOST_PATHS`) it reads
   their top-level directories instead, so a build's ignored output costs
   one argument. It reads everything when the snapshot moved (a commit, a
   switch, a moved base), when the watch named `Everything`, or past 500
   top-level directories. Such a load takes no fingerprint
   (`Review::fingerprint` is `None`), and a file not read again keeps its
   signature (`Loaded`), so no step costs the whole diff.
4. **The app keeps the last load only while a watch runs** (`Session`):
   a new watch, another repository or a failed load drops it, and the
   next load reads everything. Loads are numbered as they begin, and only
   the latest begun, after the watch started, may keep what it read. The changes move into
   `Loaded`; only files sent to the front end are copied. While watching, a watch event or focus
   loads; without a watch, focus and the 2 s poll compare fingerprints as
   before. A load that changes nothing leaves the window's state alone.
   (Amended by ADR 0014 §1: a load asked to be `full` reads everything.)

## Consequences

- An idle watch event costs reading the checkout and the snapshot (a few
  `rev-parse` and `symbolic-ref` calls) and a diff of the touched paths,
  not a full diff. Its load still names every changed file across IPC
  (path and signature, not content), O(files) where a fingerprint was
  one string. A change reported during a load is checked when the load
  ends.
- Changes git makes only to the index (`git rm --cached`) show at the
  next full read: a moved snapshot, another base, or reopening.
  (Amended by ADR 0014: ⌘/Ctrl-R asks for a full read too.)
- A rename into a path the watch did not touch shows as an addition and
  a deletion until the next full read. Both are open-tasks 10.
- Past 10,000 paths between loads (`MOST_KEPT`), what was touched counts
  as everything.
