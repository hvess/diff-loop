# 0014 — A full read on request

**Status:** accepted, 2026-10-15
**Amends:** ADR 0005 §4 (when a load reads everything) and its
Consequences (what shows only at the next full read)
**Affects:** `app/src-tauri/src/lib.rs` (`load_review`,
`Session::begin_load`), `app/src` (`api.ts`, `store.ts` `refresh`);
`docs/spec/diff-loop-app.md` Decisions 7 and 29; open task 10

## Context

While a watch runs, a load reads only what the watch saw touched
(ADR 0005 §4). Two changes reach no touched path: one to the index alone,
and a rename into a path the watch did not see (ADR 0005, Consequences;
open task 10). They showed only at the next full read: a moved snapshot,
another base, or reopening the folder. The keyboard shortcuts
(diff-loop-app.md Decision 29) add ⌘/Ctrl-R, "Check for changes now",
the developer's call, 2026-10-15. A check that keeps reading only touched
paths would not show those two changes.

## Decision

1. **`load_review` takes `full`.** When it is true, `Session::begin_load`
   still takes the kept load and what the watch touched, as any load does,
   but hands the core nothing to update from, so the core reads
   everything. The load it makes is kept as usual, and later loads read
   only what was touched again.
2. **⌘/Ctrl-R asks for one** (`refresh` in `app/src/store.ts`). Asked for
   during a load, it runs when that load ends; a poll asked for in the
   meantime does not replace it with a partial check.

## Consequences

- An index-only change, or a rename the watch did not see, shows at the
  next full read: a moved snapshot, another base, reopening, or ⌘/Ctrl-R.
  Open task 10 stays open: no load notices them on its own.
- ⌘/Ctrl-R costs one full diff of the checkout, as the first load does.
