# diff-loop-open-tasks

Work that is known, understood and not done. Each entry says what was seen, where the evidence is, and what would close it.

**Status:** active — a ledger, not a spec. Nothing here blocks anything else.
**Scope:** everything outstanding.
**Owner:** Maximilian
**Last Updated:** 2026-10-26

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
17. **Nothing in the window lists the keyboard shortcuts**
    (diff-loop-app.md Decision 29, `BINDINGS` in `app/src/keys.ts`). The
    developer chose to build the keys first and show them later
    (2026-10-15): only the Viewed checkbox's tooltip (V), the composer's
    Comment button (⌘/Ctrl-Return), the welcome screen's Open Folder…
    (⌘/Ctrl-O), a
    sent card's Resolve button (R), the preview's Copy (⌘/Ctrl-↵), the
    branch switcher's hints (↑ ↓, Return, Esc; since 2026-10-19; its
    field's ⌘/Ctrl-K and its rows' ⌘/Ctrl-O gone with ADR 0035), and
    the macOS menu bar's Open Folder and Find items name a key, and Linux
    has no menu bar (Decision 18). The HIG `offering-help` page offers
    tips to help people "discover faster ways to accomplish a task". Closes when ? (and ⌘-? on macOS, with a Help menu
    item) opens a list of the shortcuts drawn from `BINDINGS`, or the
    developer decides against one. The list waits for a design of it (the
    developer's call, 2026-10-17).

22. **Off Unix, a rewrite that restores an old mtime goes unseen without a
    watch.** The fingerprint shows a file's content by its size, mtime
    and, on Unix, its inode's change time and number (diff-loop-git.md
    Decision 4); elsewhere the standard library gives neither, so a
    same-size rewrite that restores an old mtime (`cp -p`), past the
    three racy seconds, does not change it. No build ships off Unix
    (ADR 0009). Closes when such a platform gets an equivalent, or the
    developer decides it is fine.

24. **A remote whose name has a slash is listed under its first part.**
    The base picker groups remote-tracking branches by the name before
    their first `/` (`remoteOf`, `app/src/components/BasePicker.tsx`), as
    `default_branch` splits `origin/main` (`crates/core/src/base.rs`); a
    remote named `team/fork` lists as `team`, its branches as `fork/…`.
    git's short name cannot tell the two apart. Since 2026-10-19 the
    switcher names such a branch the same way (`fold`,
    `crates/git/src/project.rs`), and since ADR 0035 lists it under that
    remote (`listsOf`), so both read one rule. Closes when
    `BaseRef` and `Branch` name a remote branch's remote (read with `git
    remote`), or the developer decides it is fine.

25. **A review open in another window is not brought forward.** The
    design's flow 6m brings the other window forward and says where it
    is only when the system refuses; each window is its own process, so
    asking the other to show itself needs a channel between instances,
    which Wayland's focus rules refuse anyway (ADR 0026 §9). The
    developer chose the notice alone for now (2026-10-19). Closes when a
    single-instance channel asks the other window to focus where the
    desktop allows it, or the developer decides the notice is enough.

27. **A claims test failed once under load.**
    `a_review_claimed_by_one_window_is_refused_to_another_until_let_go`
    (`app/src-tauri/src/claims.rs`) found the review still held
    elsewhere just after the claim was dropped
    (`assert!(!other.held_elsewhere(..))`), once, on 2026-10-23 while a
    release build ran beside the review loop; it passed five runs after.
    Why the lock outlived the dropped handle is not known. That assertion
    went with `held_elsewhere` (ADR 0035); the same delay would show as
    the test's next `take` refused, after its retries. Closes when the
    cause is found and fixed, or the test is shown not to flake.

## Store

28. **On Windows, a branch whose name has `"`, `<`, `>` or `|`, or is a
    reserved device name (`con`, `nul`, `aux`, `com1`…), cannot be
    saved.** git allows them in a branch name, Windows refuses them in a
    file name (`CON.json` included), and `name::file_name`
    (`crates/store/src/name.rs`) escapes only `%` and `/` (ADR 0030 §1).
    Closes when the escape covers them, or the developer decides
    otherwise.

## Distribution

12. **macOS builds are not signed with a Developer ID or notarized**
    (ADR 0009 §4), so Gatekeeper refuses a downloaded copy until the user
    allows it (README, Install). Closes when a release build (ADR 0028)
    signs and notarizes with a Developer ID, or the developer decides the step
    is fine.
13. **Releases reach only people with access to this repository**
    (ADR 0009 §5). Since 2026-10-26 the README is written for a public
    repository and no longer says so, and carries no release badge, which
    would not load for anyone else while it is private. Closes when the
    repository and its releases are public, or the developer decides they
    stay private.
29. **The Release workflow's macOS job may not build the glass icon.**
    A macOS build's `beforeBuildCommand` runs `npm run icon:glass`
    (`app/src-tauri/tauri.macos.conf.json`, ADR 0038 §3), which needs
    Xcode 26's `actool`; `.github/workflows/release.yml` runs that job on
    `macos-15`, whose default Xcode has not been checked against an
    `.icon`. If it cannot compile one, a hand-started run fails before
    bundling. Closes when the job runs on an image with Xcode 26 (or
    selects it) and a run is seen to pass, or the developer decides the
    workflow no longer builds the `.dmg`.
