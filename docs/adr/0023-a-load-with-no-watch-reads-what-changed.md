# 0023 — A load with no watch reads only what changed

**Status:** accepted, 2026-10-17
**Amends:** ADR 0005 §3 (an update load takes no fingerprint) and §4
(the app keeps the last load only while a watch runs)
**Affects:** `crates/core/src/repository.rs` (`Repository::file_states`,
`FileStates`, `fingerprint`'s default), `crates/core/src/review.rs`
(`load_polled`), `crates/git/src/lib.rs`, `states.rs`, `raw.rs`;
`app/src-tauri/src/lib.rs` (`Session`, `Since`); `docs/spec/diff-loop-core.md`
Decision 12, `docs/spec/diff-loop-git.md` Decision 4,
`docs/spec/diff-loop-app.md` Decision 7; open-tasks 23, closed

## Context

When no watch can start (a tree past the platform's watch limit), focus
and the 2 s poll compare fingerprints, which read no patch
(diff-loop-git.md Decision 4); but a change found loaded everything,
since nothing named what was touched (open-tasks 23). The developer asked
for every open task to be fixed, 2026-10-16.

## Decision

1. **The port tells each file's state** (`Repository::file_states`): the
   snapshot, and by path a hash of what shows a change to a changed or
   untracked file, as the fingerprint already read it. The fingerprint is
   the hash of those states (`Repository::fingerprint`'s default), so a
   poll and a load agree.
2. **With no watch, a load takes the states first and keeps them with
   what it loaded** (`load_polled`); the next compares them
   (`FileStates::touched_since`): a moved snapshot reads everything, else
   only the paths whose state differs or that one side lacks, through
   ADR 0005 §3's update. Its review carries the states' fingerprint.
3. **The app keeps the last load with or without a watch** (`Session`,
   `Since`): with one, what the watch saw touched names what changed;
   without, the kept states do. A full read, a new watch or another
   repository still starts from nothing.

## Consequences

- A checkout too large to watch reloads a changed file, not the whole
  diff; each poll and each such load cost one `git diff --raw` and a
  stat per changed and untracked file.
- A load with no watch takes the file states and, when they changed, a
  partial read: two passes where a full read was one, cheaper while few
  files change.
