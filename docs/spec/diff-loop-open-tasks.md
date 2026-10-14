# diff-loop-open-tasks

Work that is known, understood and not done. Each entry says what was seen, where the evidence is, and what would close it.

**Status:** active — a ledger, not a spec. Nothing here blocks anything else.
**Scope:** everything outstanding.
**Owner:** Maximilian
**Last Updated:** 2026-10-14

An entry leaves this file by being done, or by being decided against — in
which case the decision goes where it belongs (an ADR, or the spec it
contradicts) and the entry says so before it goes.

## App

7. **Without a watch, every check reads the whole diff.** When a watch
   cannot start (ADR 0002 §4, e.g. the inotify limit on a very large
   tree), focus and the 2 s poll take a full fingerprint, and a change
   triggers a full load (`app/src/App.tsx`, `POLL_MS`; ADR 0005 §4). Closes when a
   checkout too large to watch can be checked by less, or the developer
   decides the cost is fine.
9. **Saved reviews are never pruned, nor shared safely between
   instances.** `reviews.json` (ADR 0004) keeps an entry for every
   working tree ever reviewed, moved or deleted ones included, and each
   save rewrites it whole (`JsonReviews::save`,
   `app/src-tauri/src/reviews.rs`). Its lock is per process, so two
   running instances can overwrite each other's saves. Closes when
   entries for working trees that no longer exist are dropped, and
   saving is safe across processes, or the developer decides against
   either.
10. **Two changes show only at the next full read** (ADR 0005,
    Consequences): a change to the index alone (`git rm --cached`) moves
    no snapshot and touches no working-tree path, and a rename into a
    path the watch did not touch shows as an addition and a deletion
    (`update`, `crates/core/src/update.rs`). Closes when a load since the
    last notices both, or the developer decides the wait is fine.
11. **A linked worktree's pass records may be unguarded.** They sit in the
    main checkout's git directory (`.git/worktrees/<name>/`), outside the
    worktree's project, where the Claude Code deny rules `install-guard`
    writes may not reach (`docs/spec/diff-loop-review.md`, Pitfalls).
    Closes when a worktree's records are shown to be protected, or are
    kept where they are, or the developer decides the gap is fine.

14. **A dark-named GTK theme overrides the portal's light preference.**
    `appearance::follow` (`app/src-tauri/src/appearance.rs`) sets GTK's
    prefer-dark off, but WebKitGTK also reads the theme's name, so under
    `Arc-Dark` the window stays dark (ADR 0010, Consequences). Closes when
    a light preference shows light under such a theme, or the developer
    decides the theme should win.
15. **The macOS side of ADR 0010 has not run on a Mac**: the menu bar
    (`app/src/menuBar.ts`), the traffic lights' position and background
    throttling (`app/src-tauri/tauri.conf.json`), and the beep rule
    (`wouldBeep`, `app/src/platform.ts`). Closes when each is walked on
    macOS and any fault fixed.
16. **The design's pale greys fall below the HIG's contrast minimum**
    (4.5:1 for text): `--ui-faint` and `--ui-muted` (`app/src/styles.css`)
    draw the composer's and the card's line label ("Line 17"), the
    suggestion box's header and a viewed file's name in the sidebar at
    about 2–3.3:1 in light, 2.8–2.9:1 in dark (the UI judge's captures,
    2026-10-14). The developer kept the design's palette for now
    (`ux` skill, "Where the developer chose against the HIG"). Closes when
    those tokens, or the text drawn in them, reach 4.5:1, or the developer
    decides the palette stays.

## Distribution

12. **macOS builds are not signed with a Developer ID or notarized**
    (ADR 0009 §4), so Gatekeeper refuses a downloaded copy until the user
    allows it (README, Install). Closes when the Release workflow signs
    and notarizes with a Developer ID, or the developer decides the step
    is fine.
13. **Releases reach only people with access to this repository**
    (ADR 0009 §5). Closes when releases are published somewhere public,
    or the developer decides they stay private.
