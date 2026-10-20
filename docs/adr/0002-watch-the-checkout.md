# 0002 — Watch the checkout instead of polling it

**Status:** accepted, 2026-10-13
**Amends:** ADR 0001 §2 (adds a dependency)
**Affects:** open-tasks 7 (narrowed by ADR 0005, closed 2026-10-16 by diff-loop-git.md Decision 4); `docs/spec/diff-loop-git.md`, `docs/spec/diff-loop-app.md`

## Context

The app follows the checkout while an agent works in it. The first
version polled: every 2 s while the window had focus it asked for a
fingerprint, which runs a full `git diff`. That cost grows with the diff
and is paid even when nothing changed.

## Decision

1. **The port gains `Repository::watch`.** It calls a callback soon after
   anything in the checkout or its git state may have changed, until the
   returned guard is dropped. Calls may be spurious; the fingerprint still
   decides whether anything did change. The developer's call, 2026-10-13.
   (Amended by ADR 0005 §1: the callback names what was touched.)
2. **`diff-loop-git` watches with the `notify` crate** (8.x), recursively,
   over the working tree and, for a worktree, its git directory and the
   repository's common directory, which lie outside it. A burst of events
   is reported once, after 250 ms of quiet. (Amended by ADR 0026 §3: a
   branch no worktree has checked out is watched in the common directory
   alone.)
3. **The app emits `repository-changed`** for each report; the front end
   checks the fingerprint on that event and when the window gains focus.
   (Amended by ADR 0005 §4: while watching, it loads instead.)
4. **Polling every 2 s remains only as the fallback** when a watch cannot
   start (on Linux, the inotify watch limit).

## Consequences

- No `git` process runs while the checkout is idle.
- A very large tree can exhaust inotify watches; the app then polls as
  before (ADR 0005 §4).
