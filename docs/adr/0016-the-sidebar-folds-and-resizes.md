# 0016 — The sidebar folds, merges lone folders, and resizes

**Status:** accepted, 2026-10-15
**Supersedes:** diff-loop-app Decision 23's folding rule (folders are
labels that do not collapse, and are not merged)
**Amends:** ADR 0001 §5 (the `localStorage` keys)
**Affects:** `docs/spec/diff-loop-app.md` Decision 23; `app/src/tree.ts`,
`app/src/sidebar.ts`, `app/src/components/Sidebar.tsx`; the `ux` skill's
"Where the developer chose against the HIG"

## Context

The design ("Agent Review v2.dc.html", as edited 2026-10-15) now draws
the sidebar's folders with open and closed icons that fold on a click,
reads a chain of folders holding nothing but one folder as one row
(`src/api/share`), lets the sidebar's edge be dragged, and no longer cuts
long names short. Decision 23 (2026-10-14) had chosen a tree that neither
folds nor merges, recorded against the HIG `sidebars` page. The developer
chose to follow the new design, 2026-10-15.

## Decision

1. **Folders fold.** A click on a folder row folds it or opens it
   (`closed` in the store, by row key; open unless folded); what it holds
   leaves the rows (`fold`, `app/src/tree.ts`), and the guides are drawn
   for what is left. (Amended by ADR 0027 §7: no guides, as the canvas
   draws none.) Selecting a file, by any means, opens the folders it
   is under (`folders` on the loaded review). A folder holding one folder
   and nothing else is one row with it, `a/b/c`. Names are not cut short:
   a long one runs past the edge, and the sidebar scrolls sideways or is
   widened. (Amended by ADR 0034 §1: a long name ends in an ellipsis,
   its full path the row's tooltip, and the tree never scrolls
   sideways.)
   Folding is per session.
2. **The sidebar's width is the viewer's,** dragged at its right edge
   between 200 and 560 px, a double-click going back to the design's
   272 px, and kept in the webview's `localStorage` under
   `diff-loop.sidebar` (`app/src/sidebar.ts`), read defensively as
   `diff-loop.recent` is: a bad value falls back to the default. Two keys
   are read or written: `diff-loop.recent` and `diff-loop.sidebar`.
   (Amended by ADR 0027 §7: the default is the canvas's 240 px.)

## Consequences

- The `ux` skill's note that the tree does not fold is withdrawn: the HIG
  `sidebars` page's disclosure controls are followed (since 2026-10-16
  only in part: a folder still folds, but its open or closed icon is the
  control, with no disclosure triangle, as the design draws it, against
  the HIG `disclosure-controls` page; the developer's call, recorded in
  the `ux` skill and diff-loop-app Decision 23). (Amended by ADR 0027 §7:
  the canvas's chevron before the folder icon says it, as the HIG asks.)
- The review's `order`, and so J / K and N / P, still runs through every
  file, folded or not: a key that lands on a folded file opens its
  folders.
