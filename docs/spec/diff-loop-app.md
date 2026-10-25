# diff-loop-app

The desktop app: Tauri commands around `diff-loop-core`, and the React front end built from the "Agent Review" design, at "Agent Review v2" since 2026-10-14 and "Agent Review v3" since 2026-10-19, and being redrawn as the redesign canvas since 2026-10-22 (ADR 0027, step 16).

**Status:** active — flows 1–5 of the design landed, with its rounds since 2026-10-15, and flow 6, reviews per branch, since 2026-10-19 (step 15); the redesign (step 16) landed 2026-10-22.
**Scope:** `app/` and `app/src-tauri/`. Excludes domain logic (`diff-loop-core.md`) and git (`diff-loop-git.md`).
**Owner:** Maximilian
**Last Updated:** 2026-10-25

## Why

The design (ADR 0001, Context) has five flows: open a project, read the
change, annotate, hand off to the agent, next round.

## Steps

1. Open a project: welcome, open folder (⌘/Ctrl-O, drop, or a path on the
   command line), recent folders (reviews since 2026-10-19, step 15; projects since 2026-10-25, ADR 0033), "Not a git repository", "Nothing to
   review" — done 2026-10-13.
2. Read the change: files grouped by role with viewed progress (V),
   unified and split views, highlighting, base picker, cards for renamed,
   deleted and binary files with image previews — done 2026-10-13; a
   tree of folders and files since 2026-10-14 (step 11).
3. Annotate: click a line's gutter (its numbers or sign) for one line,
   drag or shift-click for a range then C, Suggest Change; edit, delete with
   undo — done 2026-10-13; the whole gutter, not only its numbers, since
   2026-10-14; a drag opens the composer on release since 2026-10-15
   (Decision 30).
4. Hand off: comment list, Copy Review, preview with
   format and toggles, clear with undo — done 2026-10-13; the preview is
   Markdown, edited in place, since 2026-10-14 (step 11).
5. Next round: check for changes when the watch reports one or the
   window gains focus (ADR 0002, ADR 0005 §4); when `HEAD` moves, a banner: "The
   branch moved: N new commits", "The branch was rewritten" when the old
   commit is no longer an ancestor, or "Switched to <branch>" when another
   branch is checked out (until 2026-10-19: since then another branch is
   another review, step 15), each saying how many open comments are not in
   this diff, and "Show What Changed" compares with the
   previous `HEAD` when it moved — done 2026-10-13; from 2026-10-14 to
   2026-10-15 a load also removed comments whose code changed, with Undo
   in the banner; since 2026-10-15 the agent's work shows in the round
   strip and on each sent comment instead (step 13, ADR 0015); since
   2026-10-16 a commit on top of a round sent against the uncommitted
   changes is followed, comparing with the round's commit, "The branch
   moved: 1 new commit · showing changes since round 3 (a1f3c9e)" (ADR 0017),
   and on opening after such a commit made while closed (ADR 0021).
6. Expand unchanged lines: "Show N unchanged lines" before a hunk, and
   "Show the rest of the file" after the last, read them (`file_lines`,
   diff-loop-core `lines`) and show them, highlighted, in place (Decisions
   9 and 10) — done 2026-10-13.
7. Keep a review between runs (ADR 0004): comments and note are read
   before a checkout's first load and saved as they change — done
   2026-10-13; comments only since 2026-10-14 (ADR 0013 §3); per branch
   since 2026-10-19 (step 15).
8. The base picker's notes: behind counts, the uncommitted file count
   and the last commit's id (Decision 12) — done 2026-10-13; replaced
   2026-10-17 by step 14.
9. The sidebar's captions: "tested by", "covers" and "new, imported by"
   (Decision 13) — done 2026-10-13; removed 2026-10-14 with the role
   groups (ADR 0013 §1).
10. The app icon (Decision 14) — done 2026-10-13.
11. The v2 design: the sidebar's tree and its progress header (Decisions
    23 and 24), the composer's look and suggested code without its
    shared indent (Decision 26), handles on the composer's range
    (Decision 28; its ends dragged from the gutter since Decision 35), find in file (Decision 27), the preview edited in
    place (Decision 25), and a banner with Undo for removed comments
    (Decision 16) — done 2026-10-14.
12. Keyboard shortcuts for moving through a review, commenting and
    handing off (Decision 29) — done 2026-10-15. A list of them in the
    window is not built yet (open task 17).
13. Rounds and resolution (ADR 0015, the design's component sheet of
    2026-10-15): the pins' kinds, the cards per state, the comment list
    with its marks and Resolved section, the round strip, the Copied
    popover, Re-place for a lost draft, R, and the banner without Undo
    (Decisions 16 and 31) — done 2026-10-15. With it the sidebar's
    folding and resizing (ADR 0016, Decision 23), the preview's new
    layout (Decision 25) and the composer opening on a drag's release
    (Decision 30).
14. The base picker as designed 2026-10-17 (scenes 2b, 2e and 2f):
    the first list, the lists it opens in place, ages and line counts
    (Decision 32) — done 2026-10-17.
15. Reviews per branch (the design's flow 6, ADR 0026; Decision 33): a
    review per branch, shown where its branch is, live or from its
    commits; resumed with the banners of 6f and 6g; a worktree that
    switches branch (6j); the base and Copy of a branch with no worktree
    (6h, 6i); a detached `HEAD` (6l); the review switcher (the branch
    switcher since ADR 0035) and the title
    bar's chip (6a–6e, 6k, 6m); the Welcome screen (1a); one window per
    review; ⌘/Ctrl-K — done 2026-10-19. The design's ⌃/Ctrl-Tab for the
    review shown before is not built: the HIG `keyboards` page gives
    Control-Tab to moving focus between groups of controls (the
    developer's call, 2026-10-19).
16. The redesign (ADR 0027), the canvas "Diff Loop macOS Redesign" drawn
    for Tauri, in phases:
    1. The shell (Decision 34): the canvas's palette and surfaces, the
       fonts, Lucide icons, the inset sidebar card, the toolbar's
       capsules with the layout toggle, banners as chrome cards — done
       2026-10-22.
    2. The sidebar: Filter Files, the Changes header with the files
       left, the tree's rows, Other Reviews (2a) — done 2026-10-22; Other
       Reviews removed 2026-10-25 (Decision 35).
    3. The file's header, the diff's card and the split view (2a, 2c,
       2g) — done 2026-10-22.
    4. The floating bottom bar: the progress ring, files left, lines and
       round, the comment count and Copy Review (2a, 4a) — done
       2026-10-22.
    5. Comments as gutter rails and margin notes, written in a popover,
       and the selected range without handles (3c, 3f, 5a) — done
       2026-10-22.
    6. The base picker, the switcher, the comment list, the
       instructions sheet, the banners' variants, Welcome, Nothing to
       review and the file cards (1a, 1c, 2b, 2c, 4a, 4c, 6a, 6g) — done
       2026-10-22.

## Decisions

1. **Commands only convert and delegate** (quality-gate §2). `run`
   chooses the adapter: `Session` managed state holds an `Opens`, the
   repositories it opens (a folder's, a branch's since ADR 0026, a
   project's), implemented by `diff_loop_git::GitProgram`, which looks for
   git once (diff-loop-git.md Decision 8), and the open repository as
   `dyn Repository`; setup manages `Claims` (ADR 0026 §9). `Opens` has one
   implementation on purpose: the folder is picked at run time, and §2
   keeps choosing the adapter in `run`; every repository call runs in
   `spawn_blocking`. `run` returns the runtime's error and `main` reports
   it.
2. **Native window controls.** The design draws Windows and Linux window
   buttons inside the app; the app keeps the platform's own (HIG,
   familiarity) and uses an overlay title bar only on macOS. The
   developer was told, 2026-10-13.
3. **A general note** for the instructions is written in the preview
   dialog. The design toggles it but shows no field; this is the one
   addition. Since 2026-10-14 there is none (ADR 0013 §3): the v2 design
   has no toggle either, and the preview's text is edited instead.
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
7. **One watch per open repository.** `watch_repository` runs once a
   repository opens, before its first load (ADR 0029 §1); `Session` keeps its guard, drops it when another
   opens (atomically, under `current`, which `replace` holds while it
   clears the watch and the last load), and drops a guard that arrives
   for a repository no longer open, answering `false`. The store trusts
   only answers for the repository still open; until one confirms a watch,
   or if watching fails, `App` polls every 2 s. A second watch, on the
   review shown's file (`watch_review`, ADR 0032 §4), is kept and dropped
   with it and emits `review-changed`; when it cannot start, the agent's
   marks show when the review is next shown. `Session` keeps the last
   load: while a watch runs, with what the watch touched, and
   `load_review` reads only that (ADR 0005 §4); without one, with the
   file states it took, and `load_review` reads only the paths whose
   state changed (`Since`, ADR 0023); unless it is asked to read
   everything (`full`, ⌘/Ctrl-R; ADR 0014).
8. **Limits that keep the UI responsive**, chosen by the author for the
   first version (2026-10-13), not by the design: files showing over 5000 lines,
   expanded ones included, show without highlighting (`highlight.ts`, `MAX_LINES`,
   which bounds the highlighting worker since ADR 0011); the base
   picker lists 50 matches, an exactly named ref first, and asks to type
   to narrow (`SHOWN`), in a search and in each list it opens, and the
   branch switcher 50 rows a list or search group, and Recent 8
   (`SHOWN`, `RECENT`, `switcher.ts`; ADR 0035); 8 recent
   folders were kept (`recent.ts`, `LIMIT`) until 2026-10-19, when the
   welcome screen's 8 reviews took their place (`LISTED`), and 8 recent
   projects took theirs 2026-10-25 (`recent.ts`, `LIMIT`, ADR 0033). The preview's 150 ms wait
   after the last change (`PREVIEW_DELAY_MS`) went with the note it
   waited for, 2026-10-14.

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
    Since Decision 35 the folds read "12 unchanged lines" and "Rest of
    the file", "Show …" their accessible names.

11. **Where the review store lives is chosen in `run`'s setup**, the
    composition root, as `Reviews` managed state over `dyn
    ReviewStore`; `saved_review` and `save_review` only delegate. Read
    or write failures show above the review (`SaveProblem` in
    `ReviewScreen.tsx`).

12. **The base picker's notes** (since 2026-10-17: see Decision 32): a
    base named by a full commit id, as following a round names one, is
    shown by its short id ("vs a1f3c9e", `baseLabel`; ADR 0017 §3).
    Until 2026-10-17 a branch the checkout was behind said "N behind", a
    tag "Tag", and Uncommitted changes how many files.

13. **Captions are read from names** (removed 2026-10-14, ADR 0013 §1;
    kept as history), in the front end
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
15. **Releases are built on the developer's Mac** (ADR 0028; by
    `.github/workflows/release.yml` from a `v<version>` tag until then,
    which still builds an AppImage and a `.deb` on Ubuntu 22.04 when
    started by hand on a tag matching `tauri.conf.json`): an ad-hoc
    signed Apple Silicon `.dmg`, attached to a draft release with `gh`
    (ADR 0009). 0.9.0 and 0.10.0 carry only the `.dmg`.
16. **Nothing removes a comment but the reviewer** (ADR 0015, which
    supersedes the removal this Decision held from 2026-10-13 to
    2026-10-15). A comment's lifecycle is read off its fields
    (`app/src/lifecycle.ts`, `kindOf`): a draft, sent, changed (its
    verdict changed, removed or applied), reopened (edited since sent),
    lost (a draft whose code went where it was last seen) or not in this
    diff (outdated). A comment has a card, a rail and margin note (a pin until Decision 35) and a stop for N / P only
    while current and unresolved, or resolved by the agent and not yet
    accepted (ADR 0032 §2) (`hasCard`); a lost or outdated one is
    muted in the list, opens nothing, and is still copied; a lost one
    keeps its quoted code and offers Re-place and Delete. The banner names
    only a context change: a switched (until 2026-10-19; see Decision 33),
    moved or rewritten branch, with
    "N comments are not in this diff." and Show Comments, which opens the
    list below it, and Show What Changed when `HEAD` moved, or Show
    Uncommitted Changes when it follows a commit on top of a round,
    already showing what changed (ADR 0017 §2); a later commit while it
    follows keeps that banner, counting the commits since the round's
    (`following`, `followBanner`; since 2026-10-16), until another base
    is chosen, the branch is switched or rewritten, or the core names no
    round with an open comment there (`round_to_follow`; ADR 0022). The wording
    is the `ux` skill's "Settled wording". Until 2026-10-14 the removal
    had no undo and no notice unless `HEAD` moved.
17. **The window behaves as a native one** (ADR 0010 §1): hidden until
    the front end's first paint, its size, position, maximized and
    full-screen state kept between runs, its background the page's.
    Closing the window quits, on macOS too, as on Linux. The developer's
    call, 2026-10-14.
18. **A menu bar on macOS only** (ADR 0010 §5, `app/src/menuBar.ts`):
    the app menu, File (Open Folder… ⌘O, Close Window), Edit (with Find…,
    Find Next and Find Previous since 2026-10-14), View
    (Unified, Split, Enter Full Screen), Review (Comment on Selection…,
    Next Comment, Previous Comment, Viewed) and Window, so the context
    menus' commands are in the menu bar too (HIG `context-menus`). Linux keeps none, so its layout stays
    the design's; its shortcuts work without one. The developer's call,
    2026-10-14. Menu items are title case, per the HIG's `menus` page, as
    the rest of the app's labels are since ADR 0027 §7.
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
    then the control that started it is disabled. Since Decision 35
    "Loading changes…" is the spinner's label, not words beside it.
21. **Not built:** type-ahead in the file list, because typing a letter
    there would clash with the single-letter shortcuts (Decision 29); and a translucent macOS sidebar,
    which would replace the design's sidebar colour and needs
    `macOSPrivateApi`. The developer's calls, 2026-10-14.
22. **Suggested code needs no reason** (`canSave`, `app/src/store.ts`):
    the composer saves a comment with text, or suggested code that differs
    from its lines; unchanged code still needs a reason. While the code
    differs, the reason's placeholder says it is optional; while it does
    not, "Change the code, or say why"; the field has no label, since
    with any text Comment is enabled (ux skill, Settled wording). A
    comment that is only code shows no text on its card, and "Suggested
    change" in the comment list (`commentText`); the banner named one so
    too until it only counted them (2026-10-14, a banner since gone,
    ADR 0015 §10). The developer's calls, 2026-10-14.

23. **The sidebar is a tree of the changed files** (`app/src/tree.ts`,
    ADR 0013 §1): only their folders, nested as on disk, each folder
    before its files and both by name, numbers by value. Since
    2026-10-15 (ADR 0016) a folder folds on a click, its open or closed
    folder icon saying which, as the design draws it (a disclosure
    triangle on its leading edge was removed, against the HIG
    `disclosure-controls` page, the developer's call, 2026-10-16; since
    Decision 35 the canvas's chevron before the folder icon says it) and,
    folded, how
    many changed files it holds ("3 files"; since Decision 35 nothing,
    as the canvas draws), a chain of folders holding nothing but one folder reads
    as one row (`src/api/share`), a selected file opens the folders it is
    under, names are not cut short (until ADR 0034: since 2026-10-25 a
    long one ends in an ellipsis), and the sidebar's edge drags its
    width (200–560 px, a double-click back to 240, the canvas's; 272
    until 2026-10-22), kept per viewer in
    `localStorage`. Until then folders were labels that neither folded
    nor merged (the developer's call, 2026-10-14, withdrawn 2026-10-15).
    Folders cannot be selected; the arrows, J / K, N / P and the comment
    order follow the files as the tree lists them (`order`), folded or
    not; a load that selects another file, its own having left the diff,
    opens that file's folders too. A row shows the file's icon, name and
    change letter; a viewed
    one is dimmed, its page icon ticked so colour is not all that says so
    (since Decision 35 a check in place of its letter),
    and it says "viewed" in its tooltip and its accessible name. Comment
    counts and the ✓ column are gone, as in the design. The developer's
    call, 2026-10-14.
24. **The sidebar's header counts what is left** (since Decision 35 the
    bottom bar does, the sidebar's "Changes" saying only the files left,
    and no lines added and removed beside it): a ring for the changed
    lines in viewed files out of all (`viewedLines`, kept by V and each
    load, so the header never sums them), "N files left" or "All files
    viewed", then "L lines to review" before any is reviewed, else "R of
    L lines reviewed", counted up as the ring fills (the design's "R of L
    lines to review" counted down beside it; the developer's call,
    2026-10-14), or "L lines reviewed", and nothing under it when no file
    has a changed line; the lines added and removed beside it. With no changed files
    it reads "No changed files". The wording past the design's states
    (all viewed, no lines) is the developer's call, 2026-10-14. The ring stays as
    a lasting meter, against the HIG `progress-indicators` page, which
    keeps a determinate ring for an operation under way: the developer's
    call, 2026-10-14 (`ux` skill, "Where the developer chose against the
    HIG"). Under it, since 2026-10-15, the round strip (Decision 31).
25. **The preview is edited in place** (ADR 0013 §2): Markdown, in a
    panel that looks like the code panels until it has focus, as the
    design draws it, against the HIG `entering-data` page (the
    developer's call, 2026-10-14), with "You can edit the text before
    copying." under it; focused, it has the focus ring; typing marks it
    "Edited" with "Edits change this text, not your comments." (the
    design's "Changes apply to this copy only." read as the clipboard's
    copy beside Copy to Clipboard; the developer's call, 2026-10-14) with
    Reset to Original, a bordered button so it is not taken for Cancel (the design's "Reset to generated" left unclear
    what it went back to; the developer's call, 2026-10-14),
    and Copy to Clipboard copies what is shown, ⌘/Ctrl-Return from inside
    the text too. Since 2026-10-15 the dialog is the design's restyled
    one: 720 × 700, a ✕ to close beside Cancel (two exits for one
    dialog, against the HIG `modality` page; the developer's call,
    2026-10-15, for the design's header), an "Edited" dot in its header, the
    text full-bleed between hairlines, its subtitle "5 comments across 3
    files" before any round (the kinds counted since Decision 36) and "3 new · 2 still open" after one
    (`previewSubtitle`, `app/src/round.ts`); the wording above stays
    rather than the design's "Click into the text to edit before
    copying." and "Changes apply to this copy only. Reset", the
    developer's call, 2026-10-15. Since Decision 35 it is the canvas's
    sheet (4c), 680 px wide from the window's top, "Review Instructions"
    over the branch, its base and the counts: no ✕, Esc and Cancel
    closing it; "Edited" a badge; Reset to Original shown once the text
    is edited; and under the text "Edits change this text, not your
    comments." with what copying ends, "You can edit the text before
    copying." gone with the panel look it explained. Closing the dialog keeps
    the edit (HIG `modality`: closing loses nothing typed) until it is
    copied, reset, or what the instructions are written from changes:
    the comments in the order they are written, the base or what is
    checked out (`reviewKey`; a load
    that rebuilds the comments unchanged keeps it), when the text is
    generated afresh. Copy Review copies a kept edit, as the preview
    would show it, and any copy drops it (`keptEdit`, `copyText`): the
    author's call, 2026-10-15, so a copy never leaves out what was typed.
    The text is read-only until it has arrived.
26. **Suggested code starts without its shared indent** (`suggestable`,
    `app/src/store.ts`): "Suggest Change" fills the + lines with the
    commented lines less the leading whitespace they share, the red
    lines and a saved comment's card show them the same way, and the
    code is saved and sent as typed, with nothing added back. A
    suggestion saved before this, indent and all, is shown on its card and
    opened for editing without its shared indent too, so its − and +
    lines line up and unchanged code still needs a reason. While on,
    the button read Remove Suggestion where it read Suggest Change, so
    its state was told by more than shade (HIG `accessibility`; the
    canvas's 3f since Decision 35); since ADR 0036 Suggestion is a kind in
    the composer's segmented control (Decision 36), its segment pressed. The editable + line has the canvas's
    accent ring, its corners rounded, and the header's "Edit the + line" and the caret say it
    takes typing; until Decision 35 it had none, as the v2 design drew
    it (the developer's call, 2026-10-14). The agent
    is trusted to place it. This is presentation, what the composer shows
    and starts from (`dedent`, `app/src/indent.ts`); writing a suggestion
    into the instructions stays the core's, which dedents any it is given,
    an earlier comment's indented code too (diff-loop-core Decision 6).
    The developer's call, 2026-10-14.
27. **Find in file** (`app/src/find.ts`, `FindBar.tsx`): ⌘/Ctrl-F, or
    Edit › Find… in the macOS menu bar, opens a field over the diff's top
    right, or selects its text again. It matches the text the open file
    shows, ignoring case: a unified row's one line, both sides of a split
    row, expanded lines too; a line whose lower case has another length
    (a few non-Latin letters) is not searched, since its spans would not
    line up. Every match is marked and the current one
    more strongly, with an outline; Return, ⌘/Ctrl-G (Edit › Find Next)
    and the ↓ button go to the next, Shift-Return, Shift-⌘/Ctrl-G (Find
    Previous) and the ↑ button to the previous, wrapping, with "N of M"
    or "No matches"; Esc in the field, or with focus on no other text
    field and no dialog open, and ✕ close it (another field's Esc is its
    own, as the composer's cancels it; an open comment card takes Esc
    first, and a file without a diff, which draws no bar, leaves find
    open for Esc to pass by). While the field has focus, the bar has the
    focus ring; it takes focus only when ⌘/Ctrl-F asks (`focusPending`),
    not each time the bar is drawn for another file, so the file list
    keeps the arrows. The view scrolls to the current match only when the
    reader steps or types, not when the rows change under find (expanded
    lines, Unified and Split, a refresh). The query stays while another
    file is shown, from its first match. A new query
    reads the open file's text once, deferred behind typing
    (`useDeferredValue`); one that extends a query typed on the way reads
    only the lines that one matched, and one typed on the way (Backspace)
    is not searched again (`findTyped`, which keeps one result per prefix
    of the query being typed), so typing costs what was found, not the
    file. Stepping only moves the current match, and the marks
    are built once per query. ⌘/Ctrl-F and Edit › Find… do nothing while
    a dialog is open (`dialogOpen`).
28. **The composer's range has handles** (until Decision 35, which drags
    its ends from the range's first and last gutter rows, marked by mini
    handles again since 2026-10-25) at its first line's top edge and
    its last line's bottom edge, over the line numbers, while the
    composer is open on lines. Dragging one down the gutter moves that
    end, inside the hunk (Decision 6), past the other end too; the draft
    is kept, and suggested code still as "Suggest Change" made it follows
    the lines, while code the user changed stays (`resizeComposer`). The
    selection follows the pointer, and the composer reads the lines once,
    on release, as a drag-selection does. A drag released outside the
    window, where no mouseup reaches it, ends when the pointer comes back
    over the gutter with no button down, a drag-selection too. Each handle was a 4 px bar in a
    28 × 20 px target (HIG `accessibility`, minimum control size); the
    bar kept the design's look, the developer's call, 2026-10-14. Since
    2026-10-25 each is a 12 × 4 px capsule on its line number, the
    whole 80 px gutter row its target (Decision 35). The
    header of the suggestion box says "Edit the + line" ("Edit the +
    lines" once the suggested code has more than one line), not the
    colour.

29. **Keyboard shortcuts** (`app/src/keys.ts`): one table, `BINDINGS`,
    names each window key's command, where it may run, and whether a held key
    repeats it (moves repeat; changes, such as V or ⌘/Ctrl-Backspace, do
    not). `App.tsx` runs the window's commands; `DiffView` runs the line
    cursor and change keys (`LINE_COMMANDS`), which need its rows and what
    is on screen; both admit a key by one rule (`bindingFor`,
    `app/src/platform.ts`). A text field's own keys are its own, outside `BINDINGS`:
    the composer's ⌘/Ctrl-Return, Alt-Return and Esc (`Composer.tsx`),
    and the find field's Return and Esc (`FindBar.tsx`).
    A key a focused control took (the file list's plain arrows) is left
    to it. Letters, arrows, Return and Esc act only with no text field
    focused and no dialog open; ⌘/Ctrl-O acts anywhere; the other
    ⌘/Ctrl keys act in a text field too, but not under a dialog, except
    ⌘/Ctrl-Backspace, ⌘/Ctrl-Z and ⌘/Ctrl-Shift-W, which a text field
    owns or which would drop a draft; ⌘/Ctrl-Shift-W does nothing while a
    comment is being written, wherever focus is. A letter is read in lower case with
    Shift as pressed, so Caps Lock changes nothing; `]` and `[` are read
    as typed, so the AltGr or Option that types them on a German layout
    counts; ⌘/Ctrl-1 and 2 are read by key position, as AZERTY types
    digits with Shift.

    | Keys | Command |
    |---|---|
    | J / K, or ] / [ | Next / previous file in the sidebar's order, stopping at either end |
    | Shift-J / Shift-K | Next / previous file not viewed, wrapping |
    | V | Viewed, on or off (unchanged) |
    | Shift-V | Mark viewed, then the next file not viewed; it never unmarks |
    | N / P | Next / previous comment (unchanged) |
    | ↓ / ↑ | Move the line cursor |
    | Shift-↓ / Shift-↑ | Extend the range |
    | Alt-↓ / Alt-↑ (Option) | Next / previous change |
    | C, or Return | Comment on the cursor or range; placing a lost draft, Return places it there |
    | Alt-Return (Option), in the composer | Suggestion on or off (Suggest Change until ADR 0036) |
    | E | Edit the open comment |
    | R | Resolve the open comment, which closes its card; R again unresolves it and opens the card; on one the agent resolved, accepts it (ADR 0032 §2), and on a question it answered, marks it answered (Mark Answered, ADR 0036 §2); nothing on a draft never sent and never resolved (ADR 0015 §4); a draft the agent resolved it accepts, and once accepted unresolves |
    | ⌘/Ctrl-Backspace | Delete the open comment, with Undo |
    | ⌘/Ctrl-Z | Undo the last delete, Delete Drafts or Re-place |
    | Shift-X | Show every unchanged line of the file |
    | ⌘/Ctrl-1 / ⌘/Ctrl-2 | Unified / Split |
    | ⌘/Ctrl-Shift-B | Open the base picker |
    | ⌘/Ctrl-Shift-P | Preview the instructions, with comments |
    | ⌘/Ctrl-Shift-C | Copy Review, with comments |
    | ⌘/Ctrl-R | Check for changes now |
    | ⌘/Ctrl-Shift-W | Close the folder |
    | ⌘/Ctrl-K | Open or close the branch switcher (ADR 0035), once a project is open (ADR 0033 §4; on the welcome screen too from ADR 0026 §7 until then) |
    | ⌘/Ctrl-O, ⌘/Ctrl-F, ⌘/Ctrl-G, Esc | As before (Decisions 18 and 27), except that ⌘/Ctrl-G, and the macOS menu's Find Next and Find Previous, no longer step find under a dialog |

    The line cursor is the selection. ↓ and ↑ move it a row at a time,
    keeping its side where the row has a line there, else taking the
    line a press on the gutter would (`gutterLine`); they pass over hunk
    rows and expanded lines, which take no comment (Decision 9). With no
    selection, an open comment's last line is the cursor. A cursor off
    screen, or none, starts again from what is shown: ↓ from its top, ↑
    from its bottom. Shift-↓ and Shift-↑ move the range's head along its
    side, inside its hunk (Decision 6); with no selection they place the
    cursor as ↓ and ↑ do. Alt-↓ and Alt-↑ go to the first
    line of the next or previous change, a run of added and removed lines,
    as Meld's Alt-↓ does; from inside a change, Alt-↑ goes to its own
    start first. The rows with a line and those that start a change are
    listed once per layout (`lineRows`, `changeStarts` in
    `app/src/cursor.ts`), so each key finds its row by binary search
    (`nextIn`), O(log rows), however many expanded lines it passes.
    A step scrolls only as far as shows the line, a jump centres it, as
    N / P and find do; either closes an open card, as a press on the
    gutter does. A selection made by keys is shown selected, for C to
    comment on (Decision 35: no pill). None of them acts while a comment is being written,
    whose range moves only by dragging its ends, or while the pointer drags.
    A press on the gutter takes focus from any control, so the keys that
    follow are the diff's: Return then opens the composer, where a
    focused button would otherwise take it. C and Return leave a comment
    being written as it is; until 2026-10-15 C replaced its draft.

    J, K, ] and [ step as the file list's arrows do (`stepFile`), and the
    sidebar scrolls to a file a key selects, only when the selection
    moves, as find does (Decision 27). Shift-J, Shift-K and Shift-V look
    for a file not viewed (`stepUnviewed`), in O(files viewed in a row),
    about 5 ms for 100,000 files all viewed but the last (measured
    2026-10-15); with none left, the selection stays. Shift-X reads the
    file once for all its gaps (`expandGaps`), where Show N unchanged
    lines reads one gap. ⌘/Ctrl-R
    reads the whole checkout again, even while a watch runs (`refresh`;
    ADR 0014). The base picker
    highlights the current base each time it opens, however it opens, so
    Return keeps it; → or Return opens the list under the highlight, and
    ← (with the search empty) or Esc goes back to the first list, the
    list just left highlighted (Decision 32). Its open state, the preview's and why Copy Review
    failed (`copyProblem`, a `Problem` from `describe`) live in the store, so a key can reach them;
    closing or opening a folder closes them and forgets the failure, as
    the review screen's own state went with it.

    ⌘/Ctrl-Shift-C and ⌘/Ctrl-Shift-P take the HIG's Colors window and
    Page Setup, which the HIG `keyboards` page allows when the standard
    action makes no sense in the app: Diff Loop has neither. ⌘/Ctrl-Shift-W
    is the HIG's "close a file and its associated windows".
    ⌘/Ctrl-Shift-B, and Alt-Return in the composer, are against the HIG
    (`ux` skill, "Where the developer chose against the HIG"), which records
    the single keys and these two. The new shortcuts are not shown in the
    window, in menus or tooltips, the developer's call, 2026-10-15 (`ux`
    skill, the same section): a list of them is open task 17. The set, from
    the conventions of GitLab, Gerrit, Crucible, Meld and the HIG, is the
    developer's call, 2026-10-15. R, added with ADR 0015, is shown on
    every sent card's Resolve button (and on an unsent one the agent
    resolved, ADR 0032 §2) and in the macOS Review menu, which
    reads Unresolve when the open comment is resolved; on a comment the
    agent resolved, the button reads Accept and the menu Resolve, and R
    accepts it (ADR 0032 §2). While a lost draft
    is being placed, Return places it wherever focus was left, as the bar
    over the file says.

30. **A drag-selection opens the composer when released** (the design's
    flow 3d, as edited 2026-10-15; the developer's call, 2026-10-15), on
    the lines dragged over, as a single press does. Shift-click and
    Shift-↓ / Shift-↑ still leave a range, so it can be adjusted before
    C; since Decision 35 no pill offers it.

31. **The loop's states are drawn as the design's component sheet draws
    them** (ADR 0015; `app/src/components/DiffView.tsx`, `CommentCard.tsx`,
    `CommentList.tsx`, `BottomBar.tsx`, `FilePane.tsx`):
    - **Rails and notes** (Decision 35; pins, 20 px squares in ink and
      paper, until then): a rail and margin note in the accent for a draft
      or a reopened comment, grey once sent, amber once its code changed
      (`toneOf`); beside a mark in the list, the same tone is a 6 px dot.
      Lost, resolved and outdated comments draw none.
    - **Cards:** a draft keeps Edit and Delete; a sent one shows its chip
      (Sent, Changed, Reopened), "Sent in round N · 18 min ago" (`when`;
      in `--sec`, as "You sent in
      round N"), a reopened
      one "You sent in round N" with the old text and "Copies as “Still:
      …”" (the composer shows the same while editing a sent comment), a
      changed one "Lines 21–24 → line 23" or "Line 31 · code removed" with
      the sent (−) and now (+) code under the commits it was sent on and
      is now on, "a1f3c9e → 7c20d14", or "a1f3c9e → uncommitted" when no
      commit followed; then a footer ("Untouched since sent", "… · nearby
      lines changed", "The code changed after you sent this. Resolve it
      if the change answers you." (the canvas's, since Decision 35; "Code
      changed since sent" until then), "Code removed since sent",
      "Suggestion applied") with Edit and Resolve R, primary on a
      changed card; a draft's footer has Edit and Delete in the same
      place, where the design puts them in the header (ux gate 7).
      Resolving closes the card (a resolved comment has no
      rail); R, or the macOS menu's Unresolve, then unresolves that
      comment and opens its card again (`lastResolved`), until another
      comment is shown. Only ⌘/Ctrl-Backspace deletes a sent comment.
    - **The comment list** marks each entry (Sent, Changed,
      Reopened, Code gone, Not in this diff) in words beside its dot, in
      its rail's tone (`toneOf`), keeps a lost
      draft's first line of code with Re-place and Delete, offers Resolve
      (and no Delete) on a sent comment on no line here (its file left the
      diff, or another base or branch is shown: it has no card), Delete on
      a draft not in this diff, and
      folds the resolved ones into "Resolved (n)" at the bottom, each with
      Unresolve, which opens the card again only for a comment that has
      one; one the agent resolved reads "Resolved by agent", shows the
      agent's note, and offers Accept and Edit instead (ADR 0032 §2). Text the list mutes is in
      `--sec`, which reads at 4.5:1 or more since ADR 0027,
      and the entry the keys are on is the accent row (Decision 35). Its footer
      has Preview Instructions… and Delete Drafts,
      the ellipsis since the dialog follows (HIG `buttons`).
      The count button counts open comments.
    - **The round strip**, the bottom bar's second line since Decision 35 (`roundStrip`,
      `app/src/round.ts`): "Nothing sent yet · 5 drafts"; "Round 2 sent ·
      5 comments · Just now" until the agent's work shows; then "Round 2 ·
      2 changed · 1 untouched · 1 resolved automatically", wrapping rather
      than cutting a count short. A count that steps N / P through its
      comments (`commentFilter`) is a button, filled while pressed,
      where the design draws plain text; a second press steps through all again, and a count
      whose comments have no card opens the list. A copy clears the
      filter. A reopened comment counts in neither.
    - **Copy:** "Copied · round 2 sent", "3 comments copied as
      instructions and marked Sent. Paste them into your agent session.",
      Preview Instructions… (the list's words for the same dialog) and
      Not Sent (ADR 0015 §1). The popover of a copy that sent a round
      stays until a load changes something, a comment is written, edited,
      deleted or resolved, or it is dismissed; one that sent nothing goes
      after 6 s, as does one whose round was recorded while a load or an
      edit moved the review on, so Not Sent could not be offered.
      Not Sent is drawn as the action it is, in the foreground weight. Copy Review and the
      preview's Copy are disabled with no open comment. A comment changed
      while the round is recorded keeps its change and takes what was
      sent.
    - **Re-place** (ADR 0015 §2): from the list's Re-place, the lost
      draft's file is selected when the diff has it, a bar under the file
      header names the comment ("Re-place “…”", "Click a line number ·
      Esc", then "↑ ↓ to move · Return to place · Esc"), the selected line follows the pointer or the arrows (the list leaves focus on no
      control when it closes into placing), a click or Return places it, Esc
      leaves it lost, and the undo bar says "Placed on line 16. It is a
      draft again." with Undo. The bar's 10 s wait while the preview
      covers it and start over when it closes (HIG `undo-and-redo`;
      2026-10-16), so opening the preview never uses up an undo.

32. **The base picker draws the design of 2026-10-17** (scenes 2b, 2e
    and 2f; `app/src/components/BasePicker.tsx`):
    - **The first list**, ordered by what matters while reviewing:
      Uncommitted changes with its lines added and removed ("+42 −8",
      from the review's own files when it shows them, else
      `uncommitted_lines`; a zero left out, as in the sidebar's header), Last commit with its short id, the default
      branch marked "Default" (diff-loop-core Decision 17), then, under
      a divider, a row per list it opens, with its count and ›: Local
      branches, each remote by name, and Tags. A base other than these,
      such as `release/2026.10` or a round's commit, has a row under
      Default, so it shows ✓ and Return keeps it (the developer's call,
      2026-10-17).
    - **A list opens in place**, with "‹ <list>" and its count above its
      own search ("Search local branches", "Search origin"), most
      recently updated first, each row ending with its age ("5m", "2h",
      "1d", "2w", "3mo", "1y"; `age` in `format.ts`) and its date in
      full on hover. Local branches lists the checked-out one first,
      dimmed, "Current", not to be picked; a remote's rows show its
      prefix faint ("origin/main"). Tags have a list of their own (the
      developer's call, 2026-10-17); the design draws no row for them.
    - **Typing in the first list's search** ("Search branches, tags or
      commits", where the design says "SHAs": the developer's call,
      2026-10-17) lists matching refs from every list, a tag saying
      "Tag", and offers what was typed as "Compare with “…”", which git
      resolves however it names a commit (the developer's call,
      2026-10-17; until then the row said "Commit").
    - **The design's faint text, short ages, trails and unheaded first
      list stay as drawn**
      (the developer's call, 2026-10-17; `ux` skill, "Where the developer
      chose against the HIG"); since ADR 0027 the canvas's greys read at
      4.5:1 or more, so the faint text no longer falls below it.
    - Refs, the default branch and the line counts are read again each
      time the picker opens.

33. **Reviews per branch** (ADR 0026; the design's flow 6,
    `app/src/store.ts`). Where what follows departs from the design's
    drawing or words, to meet the HIG and draw one thing one way (the
    review judges' findings), each departure is the developer's call,
    2026-10-19 (the switcher's own until ADR 0035 redrew it: its place
    line, its branch rows' words and its rows' look): "Checking…" in a row's place line, "Open without saving"
    where the design says "Look", to match the switcher's "↩ Open", tooltips for the hover
    notes and Copy's reason also written out, "Open without saving" and
    "Branches without a review" on every branch row, the other-window
    notice at the switcher's top and every notice closed by Dismiss, the
    welcome rows drawn as the switcher's (until ADR 0033 listed projects
    there), the reworded notes and banners,
    and no copy at all from a branch no worktree has.
    - **One review on screen**, kept under its `key` (the core's
      `Opening::key`; null on a detached `HEAD`). Opening a
      folder shows its branch's review; `openReview` shows one by key,
      wherever its branch is. Both go through `show`, which reads the
      saved review (`openReview` starts reading it while the checkout
      opens), has the core resume it at the opening's checkout
      (`resume_review`) and sets it
      with the checkout, so showing is not a change to save, then saves
      what resuming changed; a later `show` supersedes an earlier one
      still reading.
    - **Saves go per review** (`Saving`, by `idOf`), its base and where
      its branch was seen with its comments and rounds; a review never
      kept and still empty writes nothing, so looking at a branch leaves
      nothing (ADR 0026 §2). Only the base picker's choice is kept with
      it (`chooseBase`); a follow or Show What Changed is not, and the
      base picker says so under its first list once there is a review
      ("Saved with this review. Switching back restores this
      base."). Each load that finds the branch at another commit records
      it (`seen`).
    - **Where it is shown follows its branch** (ADR 0026 §3): a load that
      finds its worktree on another branch, or a detached one on a
      branch, shows that review's own place instead (`openReview`), the
      load itself dropped; fallen back to its commits, the banner says
      "… now has agent/share-retry checked out" with Open agent/share-retry
      (`switchedBanner`). From its commits, each poll asks whether a
      worktree has the branch now (`worktree_of`), and shows it live
      there, unannounced.
    - **What a branch with no worktree, or a detached `HEAD`, cannot do**
      (`canSend`, `canComment`, `whyNotSent`): no round is sent, so Copy
      review and the preview's Copy are disabled, their reason written
      beside Copy Review while comments are open, unless the switched
      banner, which says it, is up,
      and as the tooltip of what holds each ("feature/old-export isn’t
      checked out in any worktree. Check it out in
      one to send its comments.", one phrasing with the base picker's and
      the switched banner's, where the design says "Nothing to send to: …", which
      gave no next step; HIG `writing`), and ⌘/Ctrl-Shift-C is left to the
      page; the base picker's Uncommitted changes cannot be picked and
      says why under it, with its next step ("… Check it out in one to
      compare with its uncommitted changes."); on a detached `HEAD` no line or file takes a
      comment, its line numbers are not buttons, the macOS Review menu's
      comment item is off, and its banner says so.
    - **The branch switcher** (ADR 0035 since 2026-10-25; `Switcher.tsx`,
      its rows `listing` in `app/src/switcher.ts`; the canvas's 6a, 6b, 6k
      and 6m), from the title bar's chip or ⌘/Ctrl-K, in the base picker's
      popover: the open project's branches only. It opens on Recent, up to
      8 (`RECENT`): the branch shown, first and checked, then the
      project's reviews by when each was last shown (`seen`), then its
      local branches by their last commit; each row its name, its review's
      open comments as a badge ("3 open") when it has any, and its last
      commit's age ("2h", its date in full the tooltip). Under Recent,
      "Local Branches" and each remote ("origin", "24 branches") open
      their list in place, with a back row, as the base picker's do
      (Decision 32): → or Return opens one, ← or Esc goes back. Typing
      searches every local and remote branch, grouped under the same
      lists, at most 50 a list; "No matching branch" when none. Until the
      project's branches are read, Recent lists its reviews alone and
      "Checking…" shows after 200 ms (ADR 0010 §6); "Couldn’t read this
      project’s branches. Close and reopen this to try again." when they
      cannot be. Its reviews are read and
      each project checked every time it opens (`refreshReviews`, a
      second call joining one under way; and as the welcome screen
      shows; the core deletes the reviews of deleted branches,
      `check_kept`). ↑ ↓ move, Return opens, Esc closes; the search
      field, which takes the typing whenever the switcher is open, is
      drawn flat, as the base picker's is (`ux` skill; the developer's
      call, 2026-10-20). Until ADR 0035 it was the review switcher of
      every project's reviews, each live or committed only, with its
      moved badge and last round, and a last row opening a folder.
      Deleted branches are said
      at its top until it closes, with how many comments went (6k); a
      review another window shows says at the top, with the deletions,
      where to find it (the design puts it under the list); the window's
      own review, found deleted, is saved no more, so its next change
      does not keep it again; a failed `openReview` says nothing once
      another review has been shown since it began; each notice
      closed by Dismiss, as banners are, where the design says OK:
      "Look for “drive-web · agent/share-retry” in your window list.",
      the design's second sentence alone, since nothing asks the desktop
      to bring that window forward (6m; open-tasks 25). The window's
      title names the project and branch for that (`windowTitle`). A lock
      file that cannot be opened is `CommandError::Claim`, "Can’t tell
      whether another window shows this review"; its lock work runs off the
      async runtime, and a claim is tried three times 20 ms apart, since
      a lock has been seen to outlive its dropped handle for a moment
      (open-tasks 27).
    - **The title bar's chip** (6a, 6d, 6i, 6l), the review capsule since
      Decision 34: the branch symbol (the hollow dot when read from
      commits alone until ADR 0035), the project, the branch ("HEAD at 4e1b2a0" detached), and "No review yet", "Committed
      only" or "Detached" (since Decision 34 in its tooltip only, as the
      canvas draws the capsule without them); its hover note on "Committed only" is a tooltip
      where the design draws a popover, as the base picker's dates are. Copy's reason is written beside it (since Decision 35 above
      the bottom bar's Copy Review) while there
      are open comments, not only on hover, so it is seen without a pointer
      (HIG `feedback`). The first comment shows "Review Saved" under it for
      6 s, or until Dismiss (6e, `reviewSaved`), 260 px wide so it stays over
      the sidebar's head at its default width: "… is with your reviews now, under ⌘K.",
      where the design says "in the switcher", a word no window shows. Its hints are
      ↑ ↓, Return and Esc, without the design's ⌃Tab (step 15).
    - **The welcome screen** (1a; ADR 0033 since 2026-10-25): "Open
      Folder…", and the 8 projects most recently opened under "Recent
      Projects" (`recent.ts`, under `diff-loop.recent`), each row a
      folder symbol, the project's name and the folder it opens (`~` for
      home, in the text face); a row opens the project's main checkout,
      or a bare project's folder last opened. No review is listed, and
      neither "All Reviews ⌘K" nor ⌘/Ctrl-K opens the switcher there.
      Until 2026-10-25 it listed the 8 reviews most recently shown.
      Closing the folder lets the session go (`close_repository`), so
      another window may show its review.
    - **The banners** (`resumedBanner`, `switchedBanner`): the design's
      words for 6f, 6g and 6j, their detail wrapping rather than cut
      short, with the dot, title and actions on its first line (since
      Decision 34 the title over the detail, the actions at the end); a detached `HEAD`'s, "With no branch
      there is nowhere to keep comments, so none can be written here. Check
      out a branch to comment.", is the
      author's under ADR 0026 §5, the design's having said comments
      vanish on leaving; and the moved banner's "Comments follow their
      code.", where the design says "re-anchored", a word of the code's
      (HIG `writing`). Since Decision 34 a banner draws the warning symbol
      where it drew a dot that meant what a switcher row's did (rows with
      no dot since ADR 0035); whether
      Copy sends a round is said in words beside it. Show What Changed compares
      with the commit the branch was at, as the design's Show commits.

34. **The redesign's shell** (ADR 0027 §5; the canvas's 2a). The window
    is the canvas's: an 8 px margin, the sidebar an inset card (`.side`)
    keeping its width and resizing (ADR 0016), 240 px at first, and beside
    it the main column under a 52 px toolbar (`.tb`) of capsules (`.cap`):
    the review, which opens the switcher, the base, which opens the base
    picker, each ringed while its popover is open, and, at the end,
    Unified and Split (`.cap.seg`), moved from the file's header and
    shown, as there, only for a file with lines to show, each named in
    its tooltip. On macOS the toolbar and a 16 px strip atop the sidebar
    drag the window, whose own controls sit over the card's corner at
    the canvas's place (`trafficLightPosition` 17, 32); Linux and Windows
    keep their title bar (Decision 2), and there neither drags. A review
    read from commits alone says why it is limited on hover (the
    canvas's rules note); the chip draws the branch symbol whatever its
    place (ADR 0035; until then a hollow dot in its place). Banners, the undo bar and the save problem are the canvas's
    banner (`.banner`, 6g): the warning symbol, a title over a detail,
    their actions, and a close button named Dismiss, but for the save
    problem, which stays until Try Again works. A folder dragged
    over the window tints its outline (the canvas's rules note). The v3
    tokens keep their names, remapped to the canvas's values. The
    recommended path, 2026-10-22; revised by Decision 35.
35. **The redesign as the canvas draws it** (ADR 0027 §7; the
    developer's direction, 2026-10-22). Every screen is the canvas's
    markup on its rules, in its words and title case:
    - **The sidebar** (2a): Filter Files, which narrows the tree as typed,
      ignoring case and accents, as the switcher's and base picker's
      searches now do (`folded`), every folder open while it does, the
      open file's row kept whatever is typed so the sidebar never loses
      what the pane shows, dimmed and saying "not a match" after its
      name, its letter kept, when it does not match, and "Changes" saying how many files match
      ("1 of 4"), Esc
      clearing it (`fileFilter`, not kept), the arrows, J / K and V's step
      to the next file not viewed going through the files it keeps (from
      an open file it does not match, to the first of them); "Changes" with the files left
      and a chevron that folds it; the tree's rows with the status letter,
      or a check once viewed. A name too long for its row ends in an
      ellipsis, its letter kept, the full path its tooltip; the tree
      never scrolls sideways (the canvas's 2a; ADR 0034). Other
      Reviews, the other reviews kept, is gone from the sidebar
      (2026-10-25): another branch's review is opened from the switcher,
      another project's from Welcome or Open Folder… (ADR 0035).
    - **The bottom bar** (2a, 4a), floating over the diff: the progress
      ring of lines reviewed, the files left over the lines, drafts and
      round (`barLines`; a round's counts filter N / P as the strip's
      did), the open comments' count, which opens their list above it,
      and Copy Review, which once it copies says what was sent and
      offers Not Sent and Preview Instructions…. It replaces the
      sidebar's ring and the toolbar's comment and copy controls.
    - **The diff** (2a, 3e): the file's name as a large title over its
      path and counts, with the Viewed switch; one card of 18 px rows,
      folds reading "12 unchanged lines" with the hunk's section, or
      "Rest of the file"; Split under column heads naming the base and
      the branch, its lines cut with a fade at the column's edge. Unified
      lines wrap rather than run past the card, which the canvas, drawing
      no long line, leaves open. Split's heads sit at the card's top when
      the file's first row is a line, not a fold. The scroller leaves
      88 px under the card for the bar.
    - **Comments** (3a, 3c, 3f, 5a): a 4 px rail beside a comment's
      lines, accent for a draft, grey once sent, amber once its code
      changed; its note in the margin centred on its first line, with no
      coloured stripe on its edge (2026-10-25; it bent round the note's
      rounded end), 4 px
      under the note above where they would meet; in Split a mark that
      opens into the note on hover. Hovering a note rings its rail and
      tints its lines. A note opens the comment, and a range opens the
      composer, as a popover under the range's last line, its arrow's tip
      on that line's edge (7 px under it, where the canvas leaves 12), 400 px wide,
      520 with suggested code, 560 for a changed card. While the
      composer is open, the range's first and last gutter rows drag its
      ends, with the resize cursor, each marked by a mini handle on its
      line number, a 12 × 4 px accent capsule, 16 px wide on hover
      (the canvas's 3c and 3f, 2026-10-25; none until then); the "Comment on
      lines" pill is gone, as the canvas draws none: a range is
      commented on by releasing a drag, C, the context menu or the menu
      bar, and a lost draft is placed by clicking a line or Return.
      Ticks on the right edge mark the file's comments.
    - **Popovers and the sheet** (2b, 4a, 4c, 6a): the canvas's popover
      with its arrow; the instructions as a sheet, Reset to Original
      shown once the text is edited and no close button beside Cancel.
    - **Words**: where Decisions 32 and 33 quote a sentence-case label,
      the canvas's title case stands ("Search Branches, Tags, or
      Commits", "Last Commit", "Under review" for the checked-out
      branch's row, "4 open"; "No rounds yet" until ADR 0035). Lists in the base picker
      still open in place (Decision 32), and the switcher's foot leaves
      out the review shown before (step 15). Find in file, which the
      canvas does not draw, keeps its place over the diff in the
      popover's look. The suggestion box says "Edit the + line", by its
      mark, where the canvas says "Edit the green line" (ux gate 8; the
      canvas says "Edit the + line" too since 2026-10-25). The sheet's ⌘↩
      sits on Copy to Clipboard, not before Cancel, and a draft's
      Delete on its card is in the deletion colour, as Delete Drafts is;
      the comment list's row the keys are on is the accent row the base
      picker and switcher draw; and the Viewed switch's off track is
      grey, where the canvas's field colour barely parts from the window
      in light,
      as the bottom bar's progress ring keeps a visible track.


36. **Comments, questions and suggestions** (ADR 0036; the canvas's 3c,
    3d, 3f, 4a, 4c and 5c). The composer opens with a segmented control,
    Comment | Question | Suggestion (`.tseg`), Comment pressed; Question
    sets `question` and says under the field "The agent answers, without
    changing code.", Suggestion fills the + lines as Suggest Change did,
    and Comment or Question drops them. Its main button follows: Comment,
    Ask Question, Suggest Change (Save while editing). A sent comment's
    kind cannot change, so what it is judged against stays what was sent;
    Suggestion is offered only on a range of new lines; a kind that
    cannot be picked says why on hover ("A sent comment keeps its kind",
    "Suggested code goes on new lines"). Every kind keeps
    the plain dot on its margin note and list row; the list says
    "Question" or "Suggestion" after the place (suggested code with no
    reason already reads "Suggested change" as its text, so takes no
    word), and a note's spoken label
    names its kind. A question the agent answered is "Answered by agent",
    its card's buttons Reply and Mark Answered (R), its footer "Reply to
    ask again; it reopens the question."; a kind changed is an edit, which
    drops an agent's mark (`reopenedMark`, `keeping_agent_marks`); the round strip counts it apart
    ("1 answered, to read", the `answered` filter, the agent's other marks
    `byAgent`), and the comment count adds "N to read". Before any round
    the preview's subtitle counts the kinds ("2 comments · 1 question · 1
    suggestion", `previewSubtitle`), where it counted comments and files.

## Pitfalls

- A load answers for the comments it was sent. One changed while it ran
  (a handle drag, an edit) must keep its change: `reload` takes the
  load's version only of comments still the objects it sent, and leaves
  the rest for the next load. Until 2026-10-14 a comment moved during a
  load went back to where the load put it, keeping only its new text.

- Overlays (rails, notes, the comment popover) are placed over the
  virtualized rows from their measures (`measurementsCache`), not inside
  a row, which the next row would paint over.
- Code rows have an integer line height (18 px, the canvas's; 24 px
  until 2026-10-22), and every height around them is whole, a fold's
  hairlines being inset shadows; a fractional one leaves hairline gaps
  between measured rows.
- A native context menu needs the pointer's position (`showMenu` passes
  `clientX`/`clientY`): without one, GTK on Wayland opens it at a corner
  of the window.
- Muda's predefined Cut, Copy, Paste and Select All do nothing on Linux
  under Wayland (they send keys through libxdo, X11 only), so a context
  menu for text keeps the webview's own (Decision 19).

## Progress (2026-10-25, questions and suggestions)

ADR 0036, Decision 36: the composer's kinds, questions answered by the
agent and marked answered, and the instructions in a section per kind
(the core's `instructions`).

## Progress (2026-10-25, the branch switcher)

ADR 0035: the switcher lists the open project's branches in the base
picker's popover, Recent first and the lists opening in place; the chip
always shows the branch symbol. The core's `ReviewSummary` and
`ProjectCheck` keep only what it shows, and `KeptReview` names no project
or other window; `RoundSummary`, `CheckedReview`, `Claims::held_elsewhere`
and `LiveDot` are gone.

## Progress (2026-10-25, the canvas's sidebar and range changes)

The sidebar loses Other Reviews and its tree no longer scrolls sideways,
long names ending in an ellipsis; the range's ends get mini handles; margin
notes lose their amber stripe (Decision 35, the canvas of 2026-10-25).

## Progress (2026-10-25, the welcome screen lists projects)

ADR 0033: Welcome lists the projects most recently opened, kept by
`show` through `rememberOpened` (`recent.ts`), each opening its main
checkout; the switcher opens only once a project is shown. The canvas's
1a is redrawn to match.

## Progress (2026-10-25, the agent's marks)

ADR 0032: `instructions` names the review file shown (from the window's
claim); `watch_review` emits `review-changed` while the review shown is
watched, and the front end takes in the agent's marks
(`takeAgentMarks`, through `keep_agent_marks`). A comment resolved by the
agent stays on its lines in amber, its margin note a check and the agent's
note, "Agent: <note>" (the reviewer's comment is on its card; the
developer's call, 2026-10-25),
its card showing the note with Accept in place of Resolve, and the round
strip counting them, from any round or none ("2 resolved by agent, to
accept"), as does the comment count ("2 comments, 2 to accept"),
until the reviewer accepts it (R) or edits it, which reopens it; off its
lines, the list offers Accept and Edit with the note. Accept is where
Resolve is, on the card and R, with no hint in the window pointing at it;
and it is amber, as a changed comment is, both asking the reviewer to
look, told apart by the check and "Agent:" (the developer's calls,
2026-10-25). One the agent
resolved before it was ever sent is accepted the same way. On a changed
card the footer names the button it shows, "Accept it if the change
answers you." (the canvas's 5b; the developer's call, 2026-10-25).

## Progress (2026-10-25, the review file)

The composition root wires `diff_loop_store::FileReviews` over
`projects.json` in the app-data directory (ADR 0031 §2), in place of
`JsonReviews` and `reviews.json`, whose module is removed.

## Progress (2026-10-23, faster switching and panels)

A switch reads the saved review while the checkout opens, watches before
its first load (ADR 0029), and passes `fetchReview` the review last shown
for that review and base (`recent`, the last 4), so a return sends only
what changed and keeps the same `FileDiff`s, whose caches hold. `Session`
opens repositories through one `Opens` adapter, `GitProgram`, which looks
for git once. The pure commands (`keep_agent_marks`, `end_round`,
`round_to_follow`, `merge_reviews`) run off the main thread, as does
`instructions`, which reads the review shown and its file's place. The base
picker counts the uncommitted lines from the review when it shows them,
replaces `choices` only when they changed, and lists nothing while
closed; `setBase` no longer reads the choices again. The highlight
worker drops a request its file was left before it began. Each line's
code takes the highlights and find's marks whole, so a drag does not
draw it again. The preview writes the instructions again for a new base
or `HEAD`. After a menu action only the check items are set again.

## Progress (2026-10-22, the redesign as drawn)

Steps 16.2–16.6 (ADR 0027 §7, Decision 35): the canvas ported as it is
written: its rules in `styles.css`, Lucide through `Sym`, the sidebar
with Filter Files and Other Reviews, the bottom bar, the diff's card and
Split, comments as rails, margin notes and popovers, the base picker,
switcher, comment list, instructions sheet and Welcome redrawn, and the
labels in title case.

## Progress (2026-10-22, the redesign's shell)

Step 16.1 (ADR 0027, Decision 34): the canvas's palette, opaque surfaces,
system fonts on macOS with Geist elsewhere, and Lucide icons through
`Icon`; the inset sidebar card, the toolbar's capsules with the layout
toggle moved from the file's header, banners as chrome cards, and the
window's controls at the canvas's place. The parts still to come keep
their v3 look in the new window.

## Progress (2026-10-19, reviews per branch)

Step 15 landed (ADR 0026, Decision 33): reviews are kept and shown per
branch, live or from its commits, with the design's flow 6 (the review
switcher, its chip, its banners) and its welcome screen; the commands
`open_review`, `resume_review`, `worktree_of`, `kept_reviews` and
`check_project`, and `saved_review` and `save_review` by `ReviewKey`;
`reviews.json` is version 4 (`reviews.rs`); one window per review
(`claims.rs`); ⌘/Ctrl-K (Decision 29).

## Progress (2026-10-17, the base picker as designed)

Step 14 landed (Decision 32): the `base_choices` and
`uncommitted_lines` commands replace `refs` and `uncommitted_files`.

## Progress (2026-10-17, a load with no watch)

ADR 0023: with no watch, `Session` keeps the last load and its file
states, and `load_review` reads only what changed (Decision 7), closing
open-tasks 23.

## Progress (2026-10-16, a second commit while following)

A commit while the base follows a round keeps the follow's banner and
its way back (ADR 0022, Decision 16, `following` in `app/src/store.ts`),
closing open-tasks 21.

## Progress (2026-10-16, a commit made while closed)

ADR 0021: on opening, a commit made on top of the newest round is
followed (`followSinceOpened`, `app/src/store.ts`), closing open-tasks 20.

## Progress (2026-10-16, saved reviews pruned and locked)

ADR 0020: `reviews.json` is version 3, with when each tree was last
seen; a review whose tree has been missing for 30 days is dropped, and
saves take turns across processes (`reviews.rs`), closing open-tasks 9.

## Progress (2026-10-16, a dark-named GTK theme)

ADR 0019: on Linux, a GTK theme dark by name gives way to its light one
when the portal asks for light (`appearance.rs`), closing open-tasks 14.

## Progress (2026-10-16, a commit on top of a round)

ADR 0017: a load on the uncommitted changes that finds `HEAD` moved on
from an open round's commit compares with that commit (the
`round_to_follow` command, asked from `app/src/store.ts`), and the base picker names a full commit id by its
short one (step 5, Decisions 12 and 16).

## Progress (2026-10-15, rounds and resolution)

Step 13 landed: ADR 0015's loop (Decisions 16 and 31), ADR 0016's sidebar
(Decision 23), the preview's new layout (Decision 25), the composer on a
drag's release (Decision 30) and R (Decision 29). `reviews.json` is
version 2; a version 1 file reads and is written back as 2.

## Progress (2026-10-15, keyboard shortcuts)

Step 12 landed: the keys of Decision 29, a full read on request
(ADR 0014), and C keeping a comment being written.

## Progress (2026-10-15, the v2 audit)

An audit of the v2 change fixed seven faults: the find bar took focus
whenever it was drawn for another file, find scrolled back to its match
when the rows changed, its place carried over to the next file, Esc went
to a find bar not shown, Copy Review left out a kept preview edit, that
edit outlived a change of base, and suggestions saved with their indent
showed misaligned (Decisions 25, 26 and 27).

## Progress (2026-10-14, the v2 design)

Step 11 landed: the design's "Agent Review v2" for the sidebar, the
composer, find in file, the range handles, the preview and the banner
(ADR 0013). Decisions 3, 8, 13 and 16 say what changed in each.

## Progress (2026-10-14, suggestions without a reason)

The composer could not save suggested code until its text field had
text, and focus went to the code, so the Comment button looked broken.
It now saves either (Decision 22). Text fields' placeholders, which now
say what is needed, use `muted3`: `faint` read at about 2.8:1 in dark.

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
drawn at line numbers that hold other code (Decision 16; since 2026-10-15
nothing is deleted, ADR 0015).

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
