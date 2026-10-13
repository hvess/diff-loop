# diff-loop-app

The desktop app: Tauri commands around `diff-loop-core`, and the React front end built from the "Agent Review" design.

**Status:** active — flows 1–5 of the design landed.
**Scope:** `app/` and `app/src-tauri/`. Excludes domain logic (`diff-loop-core.md`) and git (`diff-loop-git.md`).
**Owner:** Maximilian
**Last Updated:** 2026-10-13

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
   window gains focus (ADR 0002); when `HEAD` moves, a banner: "The
   branch moved: N new commits", "The branch was rewritten" when the old
   commit is no longer an ancestor, or "Switched to <branch>" when another
   branch is checked out. Each says how many comments are outdated, and
   "Show what changed" compares with the previous `HEAD` — done
   2026-10-13.
6. Expand unchanged lines: "Show N unchanged lines" before a hunk, and
   "Show the rest of the file" after the last, read them (`file_lines`,
   diff-loop-core `lines`) and show them, highlighted, in place (Decisions
   9 and 10) — done 2026-10-13.
7. Keep a review between runs (ADR 0004): comments and note are read
   before a checkout's first load and saved as they change — done
   2026-10-13.

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
   judged by the signature `load_review` returns per file.
5. **A refresh sends only what changed.** The store passes the
   signatures it holds as `known`; unchanged files come back named and
   are carried over from the last load (`fetchReview` in
   `app/src/store.ts`).
6. **A comment range stays inside one hunk.** `withinHunk`
   (`app/src/rows.ts`) clamps every drag, shift-click and kept comment, so
   `Target::Lines` always has one `code` entry per line (diff-loop-core
   `anchor.rs`).
7. **One watch per open repository.** `watch_repository` runs after a
   repository opens; `Session` keeps its guard, drops it when another
   opens (atomically, under both locks), and drops a guard that arrives
   for a repository no longer open, answering `false`. The store trusts
   only answers for the repository still open; until one confirms a watch,
   or if watching fails, `App` polls every 2 s.
8. **Limits that keep the UI responsive**, chosen by the author for the
   first version (2026-10-13), not by the design: files showing over 5000 lines,
   expanded ones included, show without highlighting (`highlight.ts`, `MAX_LINES`); the base
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

## Pitfalls

- Overlays (composer, comment card, range pill) live inside virtualized
  rows; their row is lifted with `z-index`, or the next row paints over
  them.
- Code rows have an integer line height (25 px); a fractional one leaves
  hairline gaps between measured rows.

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
