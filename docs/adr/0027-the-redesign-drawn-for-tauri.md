# 0027 — The redesign, drawn for Tauri

**Status:** accepted, 2026-10-22
**Amends:** ADR 0001 §2 (the front-end stack gains Lucide; the fonts);
ADR 0016 §1, §2 and its Consequences (no indent guides; the sidebar 240 px
at first; a folder's chevron)
**Affects:** `docs/spec/diff-loop-app.md` (step 16, Decisions 34 and 35),
`.agents/skills/ux` (the design system), `.agents/skills/frontend`,
`app/src` (`styles.css`, the components), `app/package.json`

## Context

The developer adopted a new design for the app: the canvas "Diff Loop
macOS Redesign" (claude.ai artifact `3y8efdBu2kc95jvzU65d6j`), thirteen
screens across the five flows, with notes recording its decisions and the
rules for what it does not draw. It was drawn with macOS Liquid Glass. On
2026-10-22 the developer had it refined for Tauri: the glass replaced by
opaque layered surfaces, recorded in the canvas's "Materials for Tauri"
note, and its alignment audited. It replaces "Agent Review v3" as the
app's look.

The canvas names SF Symbols, SF Pro and SF Mono. SF Symbols are licensed
for Apple platforms only, and Diff Loop also ships for Linux and Windows.
The developer chose Lucide for the icons and the system fonts on macOS,
with the bundled Geist elsewhere, 2026-10-22.

## Decision

1. **The canvas is the app's design.** Its screens and notes are the
   authority for visual values (the `ux` skill's design system); the HIG
   stays the authority for behaviour. Where it and a recorded decision
   disagree on behaviour, `docs/spec/diff-loop-app.md` says which the app
   follows.
2. **Surfaces are opaque.** No backdrop blur: told apart by fill, a
   0.5 px hairline and shadow, from low to high the window, the sidebar
   and cards, the toolbar capsules, the bottom bar, popovers and sheets.
3. **Icons are Lucide's** (`lucide-react`), stroke icons in place of the
   SF Symbols the canvas names.
4. **Type is the system's on macOS and Geist elsewhere**: `-apple-system`
   and `ui-monospace`, which name SF Pro and SF Mono only in macOS
   WebKit, then the bundled Geist and Geist Mono.
5. **The layout is the canvas's**: an inset sidebar card; a toolbar of
   capsules (the review, the base, the layout); the file's name as a
   large title with its path, counts and a Viewed switch; the diff on one
   card; the review's state, comment count and Copy Review in a floating
   bottom bar; comments as gutter rails and margin notes, written in a
   popover; the instructions as a sheet; banners as chrome cards.
6. **It is built in phases on main** (step 16 of the app's spec).
7. **The canvas is ported, not interpreted** (the developer's direction,
   2026-10-22, after a first pass that strayed from it): its CSS rules
   are `styles.css`'s component classes as it writes them, its variable
   names aliasing the app's tokens; its markup, measures and wording are
   the components'. Labels are title case, as it writes them ("Copy
   Review", "Filter Files"); menu items were already (HIG `menus`). A
   behaviour the app records and the canvas does not draw keeps the
   app's words in the canvas's style; each knowing difference is in the
   spec (Decision 35).

## Consequences

- A screen's look is checked against the canvas, which the UI judge can
  be pointed at; the spec records what the canvas leaves undrawn.
- The v3 palette's tokens keep their names, remapped to the canvas's
  values, so a part not yet redrawn takes the new colours at once.
- `lucide-react` is a new dependency, tree-shaken to the icons used.
- A change to the look starts from the canvas's rule for it, not from a
  new class.
