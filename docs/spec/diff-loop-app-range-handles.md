# diff-loop-app-range-handles

The handles that mark the ends of a composer's range are of one normal size, and do not change size on hover.

**Status:** active — not started.
**Scope:** the range handles' look: `.hdl` in `app/src/styles.css` and the comments that name them as mini (`Gutter` in `app/src/components/DiffView.tsx`, `diff-loop-app.md`). Excludes what a handle does (drag, `pressHandle`, `resizeComposer`), its target (the whole gutter row), and any other control.
**Owner:** Maximilian
**Last Updated:** 2026-10-29

## Why

While the composer is open on lines, the range's first and last gutter rows
carry a handle each (`Gutter` in `DiffView.tsx`). Today they are 12 × 4 px
"mini" capsules that grow to 16 px wide when hovered (`.hdl`, `.hdl:hover`
in `styles.css`; `diff-loop-app.md` step 28, step 35 "Comments"). The
developer's report: they should be of a normal size, not mini, and the same
size whether hovered or not. A control that changes size under the pointer
shifts the thing the user is about to grab, and a 4 px bar is hard to see.

## Steps

1. Make the handle a normal size: in `.hdl` set `width: 20px; height: 8px;
   margin-left: -10px; border-radius: 4px` (Decision 1). Keep its colour,
   ring, shadow, cursor, `z-index`, and the `.top` / `.bot` placement.
2. Delete the `.hdl:hover` rule, and add no other rule that changes its
   size, position or scale on `:hover` or while dragged (Decision 2).
3. Reword the comment above `.hdl` and the doc comment on `Gutter`, which
   call the handles "mini" (the canvas's 3c), so they say the handle is of
   one size.
4. Records, in the same commit: in `diff-loop-app.md` change step 28 and
   step 35 "Comments" (which state "12 × 4 px accent capsule, 16 px wide on
   hover") and the Progress note of 2026-10-25 ("mini handles") to a
   pointer at this spec's Decision 1; add a dated Progress entry; bump
   `**Last Updated:**`. Add the Decision below to Decision 35's bullet by
   pointer, not by rewriting Progress history.
5. Check by eye in `npm run tauri dev`: open the composer on a range of
   several lines and on one line; both handles are 20 × 8 px, sit inside
   their end rows without being clipped by the row above or below, and do
   not change size when the pointer is over them or while one is dragged.
   Dark and light themes both.
6. Run the review loop (`.agents/skills/review/SKILL.md`) before the commit.

## Decisions

1. **The handle is a 20 × 8 px capsule.** The task says "normal size (not
   mini)" without a number. 12 × 4 px is the mini the canvas's 3c draws;
   the handle that grew on hover reached 16 px wide. 20 × 8 px is
   clearly larger than both, still fits in the 18 px row with the 40 px
   number beneath it, and does not hide the line number (which is
   right-aligned, 8 px from the number's edge, while the handle is centred
   on the number's cell). The developer to approve or revise the number;
   it is one rule in `.hdl`.
2. **No size change on any state.** Hover, press and drag leave the size
   as it is. The pointer feedback is the resize cursor (`ns-resize`),
   already set, and the "Drag to change the lines" title. No colour change
   is added: the task asks only about size.
3. **This changes the canvas's 3c, and Decision 35 of `diff-loop-app.md`.**
   ADR 0027 §7 ports the canvas as written, and Decision 35 records "a
   12 × 4 px accent capsule, 16 px wide on hover (the canvas's 3c and
   3f, 2026-10-25)". The developer's task departs from the canvas for
   this one control; the canvas is not redrawn here, and Decision 35
   gains the pointer in Step 4. No ADR is needed: no constraint or
   persisted format changes. The developer to approve this departure.
4. **The target does not change.** The whole gutter row is the target
   (step 28), so the larger capsule adds no hit area and no behaviour;
   `pressHandle`, `Gutter`'s handlers and the store are not touched.
5. **No test.** The change is a CSS size; the front end's Vitest tests
   cover the store and pure modules, and none renders `.hdl`. Step 5 is
   the check.

## Pitfalls

- Each row is its own layer, so a handle hanging out of its row is painted
  over by the next row (the comment on `.hdl`). Keep the handle inside its
  row: 8 px is within the 18 px row, and `top: 0` / `bottom: 0` stay.
- `margin-left` must be minus half of `width`, as the handle is placed by
  `left` at the centre of the number (`Gutter`); change both together.
- A one-line range puts both handles in one row, 16 px of 18 px with the
  two together at 8 px each. They would overlap by 0 px only if the row
  were shorter; do not raise the height past 8 px.

## Progress (2026-10-29, drafted)

Specified; nothing built yet.
