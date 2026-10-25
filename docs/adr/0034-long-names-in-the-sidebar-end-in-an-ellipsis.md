# 0034 — Long names in the sidebar end in an ellipsis

**Status:** accepted, 2026-10-25
**Amends:** ADR 0016 §1 (names not cut short, the sidebar scrolling sideways)
**Affects:** `docs/spec/diff-loop-app.md` (Decisions 23 and 35); `app/src/components/Sidebar.tsx`, `app/src/tree.ts`

## Context

ADR 0016 §1 kept every name whole: a long one ran past the sidebar's
edge, and the tree scrolled sideways or was widened. The developer
found the sideways scrolling unwanted and had the canvas redrawn on
2026-10-25, its 2a showing a long name cut short.

## Decision

1. **The tree never scrolls sideways.** A file or folder name too long
   for its row ends in an ellipsis; a file's status letter, or its
   check once viewed, keeps its place at the row's end. The row's
   tooltip is its full path, a folder's from the project's root.
   Widening the sidebar shows more of the name. The developer's call,
   2026-10-25, ellipsis only, without scrolling the name on hover.

## Consequences

- A name is cut at its end, so two files sharing a long prefix can read
  alike until hovered or the sidebar is widened.
- Each folder row carries its path (`TreeRow`), which the tooltip reads.
