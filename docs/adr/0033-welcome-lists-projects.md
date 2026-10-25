# 0033 — The welcome screen lists projects

**Status:** accepted, 2026-10-25
**Amends:** ADR 0026 §7 (the welcome screen listing reviews; the switcher on it); ADR 0001 §5 (`diff-loop.recent` kept again)
**Affects:** `docs/spec/diff-loop-app.md` (Decisions 29, 33 and 35); `.agents/skills/ux`; `app/src/recent.ts` (new), `app/src/store.ts`, `app/src/App.tsx`, `app/src/components/Welcome.tsx`; the canvas's 1a

## Context

Since ADR 0026 §7 the welcome screen lists the reviews most recently
shown, across projects, and opens one straight from its row; ⌘/Ctrl-K
opens the review switcher there too. The developer wants the window with
nothing open to open projects, not a given review (2026-10-25): a review
is reached from the project it belongs to.

## Decision

1. **The welcome screen lists the projects most recently opened**, under
   "Recent Projects", the 8 newest first: every project a window showed,
   by Open Folder…, a drop, a path given at launch or the switcher,
   whether or not it holds a review. A project is its common git
   directory, listed once whatever worktree it was opened from. The
   developer's call, 2026-10-25.
2. **A row is the project's name and its folder**, nothing more: no
   review, comment or round counts. The developer's call, 2026-10-25.
3. **A row opens the project's main checkout**, as Open Folder… on it
   would: the folder whose `.git` the common git directory is. A project
   with no such folder (a bare repository) opens the folder it was last
   opened from. The developer's call, 2026-10-25.
4. **The switcher is not on the welcome screen**: no "All Reviews ⌘K",
   and ⌘/Ctrl-K does nothing there. It opens once a project is shown,
   where it still lists every project's reviews (ADR 0026 §7). The
   developer's call, 2026-10-25.
5. **The list is kept in `localStorage` under `diff-loop.recent`**, as
   ADR 0001 §5 kept recent folders, each entry the project, its name,
   the folder a row opens and when it was opened; an entry of the
   earlier shape, or anything unreadable, is dropped.

## Consequences

- A project whose folder is gone stays listed; opening it reports the
  problem under Open Folder…, as a failed open does.
- The list is per machine and per webview, not shared with the MCP
  server or kept in a project; `projects.json` (ADR 0031 §2) still lists
  only the projects holding a review, for the switcher.
- The welcome screen still checks the kept reviews as the app starts, so
  a deleted branch's reviews go (ADR 0026 §6), though it lists none.
