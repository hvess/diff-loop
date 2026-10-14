# diff-loop-app

The desktop app: Tauri commands around `diff-loop-core`, and the React front end built from the "Agent Review" design.

**Status:** active — flows 1–5 of the design landed.
**Scope:** `app/` and `app/src-tauri/`. Excludes domain logic (`diff-loop-core.md`) and git (`diff-loop-git.md`).
**Owner:** Maximilian
**Last Updated:** 2026-10-14

## Why

The design (ADR 0001, Context) has five flows: open a project, read the
change, annotate, hand off to the agent, next round.

## Steps

1. Open a project: welcome, open folder (⌘/Ctrl-O, drop, or a path on the
   command line), recent folders, "Not a git repository", "Nothing to
   review" — done 2026-10-13.
2. Read the change: files grouped by role with viewed progress (V),
   unified and split views, highlighting, base picker, cards for renamed,
   deleted and binary files with image previews — done 2026-10-13.
3. Annotate: click a line number for one line, drag or shift-click for a
   range then C, Suggest code; edit, delete with undo — done 2026-10-13.
4. Hand off: comment list (N / P to jump), Copy review, preview with
   format and toggles, clear with undo — done 2026-10-13.
5. Next round: check for changes when the watch reports one or the
   window gains focus (ADR 0002, ADR 0005 §4); when `HEAD` moves, a banner: "The
   branch moved: N new commits", "The branch was rewritten" when the old
   commit is no longer an ancestor, or "Switched to <branch>" when another
   branch is checked out. Each names the comments it deleted, and says
   how many of the rest are not in this diff or still apply (Decision
   16), and
   "Show what changed" compares with the previous `HEAD` — done
   2026-10-13.
6. Expand unchanged lines: "Show N unchanged lines" before a hunk, and
   "Show the rest of the file" after the last, read them (`file_lines`,
   diff-loop-core `lines`) and show them, highlighted, in place (Decisions
   9 and 10) — done 2026-10-13.
7. Keep a review between runs (ADR 0004): comments and note are read
   before a checkout's first load and saved as they change — done
   2026-10-13.
8. The base picker's notes: behind counts, the uncommitted file count
   and the last commit's id (Decision 12) — done 2026-10-13.
9. The sidebar's captions: "tested by", "covers" and "new, imported by"
   (Decision 13) — done 2026-10-13.
10. The app icon (Decision 14) — done 2026-10-13.

## Decisions

1. **Commands only convert and delegate** (quality-gate §2). `run`
   chooses the adapter (`open_git`); `Session` managed state holds it and
   the open repository as `dyn Repository`. The `Opener` indirection has
   one implementation on purpose: the folder is picked at run time, and
   §2 keeps choosing the adapter in `run`; every repository call runs in
   `spawn_blocking`. `run` returns the runtime's error and `main` reports
   it.
2. **Native window controls.** The design draws Windows and Linux window
   buttons inside the app; the app keeps the platform's own (HIG,
   familiarity) and uses an overlay title bar only on macOS. The
   developer was told, 2026-10-13.
3. **A general note** for the instructions is written in the preview
   dialog. The design toggles it but shows no field; this is the one
   addition.
4. **Viewed marks reset** when a file's diff changes after a refresh,
   judged by the signature `load_review` sends per file.
5. **A refresh sends only what changed.** The store passes the
   signatures it holds as `known`; unchanged files come back named and
   are carried over from the last load (`fetchReview` in
   `app/src/store.ts`). They arrive in batches (ADR 0012), which
   `api.loadReview` joins.
6. **A comment range stays inside one hunk.** `withinHunk`
   (`app/src/rows.ts`) clamps every drag and shift-click, so
   `Target::Lines` always has one `code` entry per line (diff-loop-core
   `anchor.rs`).
7. **One watch per open repository.** `watch_repository` runs after a
   repository opens; `Session` keeps its guard, drops it when another
   opens (atomically, under `current`, which `replace` holds while it
   clears the watch and the last load), and drops a guard that arrives
   for a repository no longer open, answering `false`. The store trusts
   only answers for the repository still open; until one confirms a watch,
   or if watching fails, `App` polls every 2 s. While a watch runs,
   `Session` keeps the last load and what the watch touched, and
   `load_review` reads only that (ADR 0005 §4).
8. **Limits that keep the UI responsive**, chosen by the author for the
   first version (2026-10-13), not by the design: files showing over 5000 lines,
   expanded ones included, show without highlighting (`highlight.ts`, `MAX_LINES`,
   which bounds the highlighting worker since ADR 0011); the base
   picker lists 50 matches, an exactly named ref first, and asks to type
   to narrow (`SHOWN`); 8 recent
   folders are kept (`recent.ts`, `LIMIT`); the preview rebuilds 150 ms
   after the last change (`PREVIEW_DELAY_MS`).

9. **Expanded lines cannot be commented on**: they are context for
   reading. A comment's code comes from the diff (diff-loop-core
   Decision 3), and lines read by `file_lines` are not in it; their
   numbers are not buttons (`Cell.shown`). The developer's call,
   2026-10-13.
10. **Expansions** open the gap before any hunk ("Show N unchanged
    lines") and after the last ("Show the rest of the file", `REST`),
    except in an added or deleted file, whose diff is the whole file.
    They last while the file's signature holds, as viewed marks do
    (Decision 4), and are dropped when the base changes. The diff cannot
    say whether its last hunk reaches the file's end, so "Show the rest
    of the file" is offered anyway; when nothing follows, the row goes.

11. **Where the review store lives is chosen in `run`'s setup**, the
    composition root, as `Reviews` managed state over `dyn
    ReviewStore`; `saved_review` and `save_review` only delegate. Read
    or write failures show above the review (`SaveProblem` in
    `ReviewScreen.tsx`).

12. **The base picker's notes:** a branch or remote the checkout is
    behind says "N behind" (diff-loop-core Decision 13), a tag says
    "Tag", Uncommitted changes says how many files (`uncommitted_files`),
    and Last commit shows its short id, as the design does. Refs and the
    file count are read again each time the picker opens.

13. **Captions are read from names**, in the front end
    (`app/src/links.ts`), so they suggest rather than prove: a test
    covers the source its name carries without its marker (`.test.`,
    `.spec.`, `_test.`, `_spec.`, `test_`), the one beside it first, else
    the only one of that name; a new file is imported by a changed file
    whose added lines name it beside an importing word (`import`, `from`,
    `require`, `use`, `include`, `mod`). Each file's words are read once
    per version. The author's reading of the design, 2026-10-13.

14. **The app icon is design 2a, "Pinned line"** (claude.ai/design
    project `df71ed5c-a97b-4293-a1f7-f31eb6b93f9b`, `App Icon.dc.html`),
    in its light appearance as the canvas draws it, on the macOS grid:
    `icons/app-icon.svg` is the source, and `npx tauri icon
    src-tauri/icons/app-icon.svg -o src-tauri/icons` in `app/` makes the
    desktop sizes `tauri.conf.json` lists; the others it makes are not
    kept. The design's `icon/` layers are for Icon Composer, which this
    app does not use yet. The developer's choice, 2026-10-13.
15. **Releases are built by `.github/workflows/release.yml`** from a
    `v<version>` tag matching `tauri.conf.json`: an AppImage and a `.deb`
    on Ubuntu 22.04, an ad-hoc signed Apple Silicon `.dmg` on macOS
    (ADR 0009).
16. **A comment whose code changed is deleted.** When a load against the
    same base, with the same branch checked out (a detached `HEAD` counts
    as one branch), finds a current comment's code gone (it changed, or
    its file left the diff), `reload` deletes it, with no undo, and with
    no notice unless `HEAD` moved too; one being edited is kept. After the
    base or branch changed, or on opening a checkout, it is only outdated:
    it draws no pin, and its list entry, the comment count and the move
    banner say it is not in this diff, the banner with Show comments,
    which opens the list below the banner (the banner names each comment
    deleted at the move by its place and the start of its text, and counts
    the rest as they are now), until a load finds its code again
    (diff-loop-core Decision 4). Having no card, it is skipped by N / P,
    as the list's hint says, and its list entry is muted, opens nothing
    and has Delete, and an open card closes; it is still copied into the
    instructions. Deleting without undo is an exception to the `ux`
    skill's gate line 6, and the wording is the `ux` skill's "Settled
    wording". The developer's calls, 2026-10-13 and 2026-10-14.

17. **The window behaves as a native one** (ADR 0010 §1): hidden until
    the front end's first paint, its size, position, maximized and
    full-screen state kept between runs, its background the page's.
    Closing the window quits, on macOS too, as on Linux. The developer's
    call, 2026-10-14.
18. **A menu bar on macOS only** (ADR 0010 §5, `app/src/menuBar.ts`):
    the app menu, File (Open Folder… ⌘O, Close Window), Edit, View
    (Unified, Split, Enter Full Screen), Review (Comment on Selection…,
    Next Comment, Previous Comment, Viewed) and Window, so the context
    menus' commands are in the menu bar too (HIG `context-menus`). Linux keeps none, so its layout stays
    the design's; its shortcuts work without one. The developer's call,
    2026-10-14. Menu items are title case, per the HIG's `menus` page,
    where the rest of the app's text is sentence case.
19. **Context menus** (ADR 0010 §5, `app/src/contextMenu.ts`): a file in
    the sidebar offers Viewed; a line that can take a comment offers
    "Comment on Line N…" ("Removed Line" on the old side), or "Comment on
    Lines A–B…" when it is inside the selected range; the ellipsis because
    the composer then asks for the text (HIG `menus`). A text field and
    selected text keep the webview's own menu, which is the platform's;
    elsewhere there is none.
20. **Indicators wait 200 ms** (ADR 0010 §6, `app/src/delay.ts`):
    "Opening…", "Loading changes…", "Showing N unchanged lines…" and an
    image preview's "Loading…" appear only once the wait reaches it; until
    then the control that started it is disabled.
21. **Not built:** type-ahead in the file list, because typing a letter
    there would clash with V, N, P and C; and a translucent macOS sidebar,
    which would replace the design's sidebar colour and needs
    `macOSPrivateApi`. The developer's calls, 2026-10-14.

## Pitfalls

- Overlays (composer, comment card, range pill) live inside virtualized
  rows; their row is lifted with `z-index`, or the next row paints over
  them.
- Code rows have an integer line height (25 px); a fractional one leaves
  hairline gaps between measured rows.
- A native context menu needs the pointer's position (`showMenu` passes
  `clientX`/`clientY`): without one, GTK on Wayland opens it at a corner
  of the window.
- Muda's predefined Cut, Copy, Paste and Select All do nothing on Linux
  under Wayland (they send keys through libxdo, X11 only), so a context
  menu for text keeps the webview's own (Decision 19).

## Progress (2026-10-14, the review in batches)

`load_review` streams its files through a `Channel` (ADR 0012), so a large
review is parsed in pieces; Decision 5 still holds, batch by batch.

## Progress (2026-10-14, rendering off the UI thread)

Highlighting moved to a Web Worker and the React Compiler builds the
components (ADR 0011). Decision 8's `MAX_LINES` now bounds the worker.

## Progress (2026-10-14, native behaviour)

The window, its menus, its theme on Linux and its indicators behave as a
native app's (ADR 0010; Decisions 17–21). Walked on Linux (WebKitGTK
2.54, Sway): the window appears painted, context menus open at the
pointer and act, a text field keeps the GTK edit menu, and the portal's
colour scheme switches the window live.

## Progress (2026-10-13, comments deleted when their code changes)

Comments whose code changed are deleted, and outdated ones are no longer
drawn at line numbers that hold other code (Decision 16).

## Progress (2026-10-13, releases)

A tag now releases installers for Linux and Apple Silicon (Decision 15).

## Progress (2026-10-13, the TypeScript audit)

The front end was audited against the `mastering-typescript` skill. Lint
reads types and `exactOptionalPropertyTypes` is on (ADR 0008).
`describe` (`api.ts`) now reads a failure as a `CommandError` only when it
is an object with a `kind`, and switches over every variant with a `never`
fallback, so a new error kind in Rust fails the type check until it has
words.

## Progress (2026-10-13, the app icon)

Step 10 landed.

## Progress (2026-10-13, the sidebar's captions)

Step 9 landed.

## Progress (2026-10-13, the base picker's notes)

Step 8 landed, with the counts read again each time the picker opens.

## Progress (2026-10-13, reading only what was touched)

A watch event loads only the touched paths, and a load that changes
nothing keeps the window's state (`showsTheSame` in `app/src/store.ts`).

## Progress (2026-10-13, reviews kept between runs)

Step 7 landed, with the store's save trigger tested (`app/src/store.test.ts`).

## Progress (2026-10-13, expanding unchanged lines)

Step 6 landed. A gap is now measured from the hunks' own line numbers
(`gapBefore` in `app/src/rows.ts`): git's `+N,0` header names the line
before a pure deletion, and the old count was one short there. The first
front-end tests landed with it (`app/src/rows.test.ts`, ADR 0003).

## Progress (2026-10-13, first version)

Built and walked through every design state against a fixture repository,
in light and dark, on Linux (WebKitGTK, Sway).
