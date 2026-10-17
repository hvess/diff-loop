# diff-loop-open-tasks

Work that is known, understood and not done. Each entry says what was seen, where the evidence is, and what would close it.

**Status:** active — a ledger, not a spec. Nothing here blocks anything else.
**Scope:** everything outstanding.
**Owner:** Maximilian
**Last Updated:** 2026-10-17

An entry leaves this file by being done, or by being decided against — in
which case the decision goes where it belongs (an ADR, or the spec it
contradicts) and the entry says so before it goes.

## App

15. **The macOS side of ADR 0010 has not run on a Mac**: the menu bar
    (`app/src/menuBar.ts`), the traffic lights' position and background
    throttling (`app/src-tauri/tauri.conf.json`), and the beep rule
    (`wouldBeep`, `app/src/platform.ts`). Nor have the ⌘ and Option
    shortcuts (diff-loop-app.md Decision 29, `app/src/keys.ts`), among
    them ⌘Z beside the menu bar's own Undo, and Option-↓ and
    Option-Return. Closes when each is walked on macOS and any fault fixed.
16. **The design's pale greys fall below the HIG's contrast minimum**
    (4.5:1 for text): `--ui-faint` and `--ui-muted` (`app/src/styles.css`)
    draw the composer's and the card's line label ("Line 17"), the
    suggestion box's header and a viewed file's name in the sidebar at
    about 2–3.3:1 in light, 2.8–2.9:1 in dark (the UI judge's captures,
    2026-10-14). The developer kept the design's palette for now
    (`ux` skill, "Where the developer chose against the HIG"). Closes when
    those tokens, or the text drawn in them, reach 4.5:1, or the developer
    decides the palette stays.
17. **Nothing in the window lists the keyboard shortcuts**
    (diff-loop-app.md Decision 29, `BINDINGS` in `app/src/keys.ts`). The
    developer chose to build the keys first and show them later
    (2026-10-15): only the Viewed checkbox's tooltip (V), the composer's
    Comment button (⌘/Ctrl-Return), the welcome screen's Open folder
    (⌘/Ctrl-O), the comments list's hint (N / P), the range pill (C), a
    sent card's Resolve button (R), the preview's Copy (⌘/Ctrl-↵) and
    the macOS menu bar's Open Folder and Find items name a key, and Linux
    has no menu bar (Decision 18). The HIG `offering-help` page offers
    tips to help people "discover faster ways to accomplish a task". Closes when ? (and ⌘-? on macOS, with a Help menu
    item) opens a list of the shortcuts drawn from `BINDINGS`, or the
    developer decides against one.

19. **The design's README is not the repository's.** The design project
    holds a `README.md` for a public repository (an MIT licence, release
    badges, a screenshot at `docs/review-screen.png`, build-from-source
    steps); the repository's README is the private one. The developer
    left it for later, 2026-10-15. Closes when the README is brought in,
    with its claims made true (a `LICENSE`, a public repository), or the
    developer decides against it.

22. **Off Unix, a rewrite that restores an old mtime goes unseen without a
    watch.** The fingerprint shows a file's content by its size, mtime
    and, on Unix, its inode's change time and number (diff-loop-git.md
    Decision 4); elsewhere the standard library gives neither, so a
    same-size rewrite that restores an old mtime (`cp -p`), past the
    three racy seconds, does not change it. No build ships off Unix
    (ADR 0009). Closes when such a platform gets an equivalent, or the
    developer decides it is fine.

## Distribution

12. **macOS builds are not signed with a Developer ID or notarized**
    (ADR 0009 §4), so Gatekeeper refuses a downloaded copy until the user
    allows it (README, Install). Closes when the Release workflow signs
    and notarizes with a Developer ID, or the developer decides the step
    is fine.
13. **Releases reach only people with access to this repository**
    (ADR 0009 §5). Closes when releases are published somewhere public,
    or the developer decides they stay private.
