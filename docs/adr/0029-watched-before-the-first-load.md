# 0029 — Watched before the first load

**Status:** accepted, 2026-10-23
**Amends:** ADR 0005 §3 (only an update load takes no fingerprint)
**Affects:** `app/src/store.ts` (`show`, `poll`), `crates/core/src/review.rs`
(`load_with`, `Review::fingerprint`); `docs/spec/diff-loop-app.md`
Decision 7, `docs/spec/diff-loop-core.md` Decision 12

## Context

Showing a review loaded it, then started its watch. A watch that starts
drops the last load (`Session::keep_watch`), since what changed before it
started is unknown, so the first watch event after every switch read the
whole checkout again. A full load under a watch also took a fingerprint,
a second `git diff --raw` and `ls-files --others` over the working tree,
which no poll compares while a watch runs. The developer asked for the
switch to be made faster, 2026-10-23.

## Decision

1. **`show` starts the watch, and awaits it, before the first load.** The
   first load is then the one the watch's events bring up to date. A watch
   event during that load is checked once it ends (`poll` sets `recheck`
   while the review is still loading).
2. **A load under a watch takes no fingerprint** (`load`), full or not;
   `Review::fingerprint` is `None` for it. A load with no watch
   (`load_polled`) carries its file states' fingerprint, as ADR 0023 §2
   has it.

## Consequences

- A switch reads the working tree once, not three times (the
  fingerprint, the load, and again at the first event).
- The first load waits for the watch to start. With FSEvents that is
  milliseconds. With inotify the recursive watch walks the tree first,
  as it did before, just after the load.
