# diff-loop-app

The desktop app: Tauri commands around `diff-loop-core`, and the React front end built from the "Agent Review" design, at "Agent Review v2" since 2026-10-14.

**Status:** active — flows 1–5 of the design landed, with its rounds since 2026-10-15.
**Scope:** `app/` and `app/src-tauri/`. Excludes domain logic (`diff-loop-core.md`) and git (`diff-loop-git.md`).
**Owner:** Maximilian
**Last Updated:** 2026-10-16

## Why

The design (ADR 0001, Context) has five flows: open a project, read the
change, annotate, hand off to the agent, next round.

## Steps

1. Open a project: welcome, open folder (⌘/Ctrl-O, drop, or a path on the
   command line), recent folders, "Not a git repository", "Nothing to
   review" — done 2026-10-13.
2. Read the change: files grouped by role with viewed progress (V),
   unified and split views, highlighting, base picker, cards for renamed,
   deleted and binary files with image previews — done 2026-10-13; a
   tree of folders and files since 2026-10-14 (step 11).
3. Annotate: click a line's gutter (its numbers or sign) for one line,
   drag or shift-click for a range then C, Suggest code; edit, delete with
   undo — done 2026-10-13; the whole gutter, not only its numbers, since
   2026-10-14; a drag opens the composer on release since 2026-10-15
   (Decision 30).
4. Hand off: comment list (N / P to jump), Copy review, preview with
   format and toggles, clear with undo — done 2026-10-13; the preview is
   Markdown, edited in place, since 2026-10-14 (step 11).
5. Next round: check for changes when the watch reports one or the
   window gains focus (ADR 0002, ADR 0005 §4); when `HEAD` moves, a banner: "The
   branch moved: N new commits", "The branch was rewritten" when the old
   commit is no longer an ancestor, or "Switched to <branch>" when another
   branch is checked out, each saying how many open comments are not in
   this diff, and "Show what changed" compares with the
   previous `HEAD` when it moved — done 2026-10-13; from 2026-10-14 to
   2026-10-15 a load also removed comments whose code changed, with Undo
   in the banner; since 2026-10-15 the agent's work shows in the round
   strip and on each sent comment instead (step 13, ADR 0015); since
   2026-10-16 a commit on top of a round sent against the uncommitted
   changes is followed, comparing with the round's commit, "The branch
   moved: 1 new commit · showing changes since round 3 (a1f3c9e)" (ADR 0017).
6. Expand unchanged lines: "Show N unchanged lines" before a hunk, and
   "Show the rest of the file" after the last, read them (`file_lines`,
   diff-loop-core `lines`) and show them, highlighted, in place (Decisions
   9 and 10) — done 2026-10-13.
7. Keep a review between runs (ADR 0004): comments and note are read
   before a checkout's first load and saved as they change — done
   2026-10-13; comments only since 2026-10-14 (ADR 0013 §3).
8. The base picker's notes: behind counts, the uncommitted file count
   and the last commit's id (Decision 12) — done 2026-10-13.
9. The sidebar's captions: "tested by", "covers" and "new, imported by"
   (Decision 13) — done 2026-10-13; removed 2026-10-14 with the role
   groups (ADR 0013 §1).
10. The app icon (Decision 14) — done 2026-10-13.
11. The v2 design: the sidebar's tree and its progress header (Decisions
    23 and 24), the composer's look and suggested code without its
    shared indent (Decision 26), handles on the composer's range
    (Decision 28), find in file (Decision 27), the preview edited in
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
7. **One watch per open repository.** `watch_repository` runs after a
   repository opens; `Session` keeps its guard, drops it when another
   opens (atomically, under `current`, which `replace` holds while it
   clears the watch and the last load), and drops a guard that arrives
   for a repository no longer open, answering `false`. The store trusts
   only answers for the repository still open; until one confirms a watch,
   or if watching fails, `App` polls every 2 s. While a watch runs,
   `Session` keeps the last load and what the watch touched, and
   `load_review` reads only that (ADR 0005 §4), unless it is asked to
   read everything (`full`, ⌘/Ctrl-R; ADR 0014).
8. **Limits that keep the UI responsive**, chosen by the author for the
   first version (2026-10-13), not by the design: files showing over 5000 lines,
   expanded ones included, show without highlighting (`highlight.ts`, `MAX_LINES`,
   which bounds the highlighting worker since ADR 0011); the base
   picker lists 50 matches, an exactly named ref first, and asks to type
   to narrow (`SHOWN`); 8 recent
   folders are kept (`recent.ts`, `LIMIT`). The preview's 150 ms wait
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

11. **Where the review store lives is chosen in `run`'s setup**, the
    composition root, as `Reviews` managed state over `dyn
    ReviewStore`; `saved_review` and `save_review` only delegate. Read
    or write failures show above the review (`SaveProblem` in
    `ReviewScreen.tsx`).

12. **The base picker's notes:** a branch or remote the checkout is
    behind says "N behind" (diff-loop-core Decision 13), a tag says
    "Tag", Uncommitted changes says how many files (`uncommitted_files`),
    and Last commit shows its short id, as the design does; a base named
    by a full commit id, as following a round names one, is shown by its
    short id ("vs a1f3c9e", `baseLabel`; ADR 0017 §3). Refs and the
    file count are read again each time the picker opens.

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
15. **Releases are built by `.github/workflows/release.yml`** from a
    `v<version>` tag matching `tauri.conf.json`: an AppImage and a `.deb`
    on Ubuntu 22.04, an ad-hoc signed Apple Silicon `.dmg` on macOS
    (ADR 0009).
16. **Nothing removes a comment but the reviewer** (ADR 0015, which
    supersedes the removal this Decision held from 2026-10-13 to
    2026-10-15). A comment's lifecycle is read off its fields
    (`app/src/lifecycle.ts`, `kindOf`): a draft, sent, changed (its
    verdict changed, removed or applied), reopened (edited since sent),
    lost (a draft whose code went where it was last seen) or not in this
    diff (outdated). A comment has a card, a pin and a stop for N / P only
    while current and unresolved (`hasCard`); a lost or outdated one is
    muted in the list, opens nothing, and is still copied; a lost one
    keeps its quoted code and offers Re-place and Delete. The banner names
    only a context change: a switched, moved or rewritten branch, with
    "N comments are not in this diff." and Show comments, which opens the
    list below it, and Show what changed when `HEAD` moved, or Show
    uncommitted changes when it follows a commit on top of a round,
    already showing what changed (ADR 0017 §2). The wording
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
    `disclosure-controls` page, the developer's call, 2026-10-16) and,
    folded, how
    many changed files it holds ("3 files"), a chain of folders holding nothing but one folder reads
    as one row (`src/api/share`), a selected file opens the folders it is
    under, names are not cut short, and the sidebar's edge drags its
    width (200–560 px, a double-click back to 272), kept per viewer in
    `localStorage`. Until then folders were labels that neither folded
    nor merged (the developer's call, 2026-10-14, withdrawn 2026-10-15).
    Folders cannot be selected; the arrows, J / K, N / P and the comment
    order follow the files as the tree lists them (`order`), folded or
    not; a load that selects another file, its own having left the diff,
    opens that file's folders too. A row shows the file's icon, name and
    change letter; a viewed
    one is dimmed, its page icon ticked so colour is not all that says so,
    and it says "viewed" in its tooltip and its accessible name. Comment
    counts and the ✓ column are gone, as in the design. The developer's
    call, 2026-10-14.
24. **The sidebar's header counts what is left**: a ring for the changed
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
    copy beside Copy to clipboard; the developer's call, 2026-10-14) with
    Reset to original, a bordered button so it is not taken for Cancel (the design's "Reset to generated" left unclear
    what it went back to; the developer's call, 2026-10-14),
    and Copy to clipboard copies what is shown, ⌘/Ctrl-Return from inside
    the text too. Since 2026-10-15 the dialog is the design's restyled
    one: 720 × 700, a ✕ to close beside Cancel (two exits for one
    dialog, against the HIG `modality` page; the developer's call,
    2026-10-15, for the design's header), an "Edited" dot in its header, the
    text full-bleed between hairlines, its subtitle "5 comments across 3
    files" before any round and "3 new · 2 still open" after one
    (`previewSubtitle`, `app/src/round.ts`); the wording above stays
    rather than the design's "Click into the text to edit before
    copying." and "Changes apply to this copy only. Reset", the
    developer's call, 2026-10-15. Closing the dialog keeps
    the edit (HIG `modality`: closing loses nothing typed) until it is
    copied, reset, or what the instructions are written from changes:
    the comments in the order they are written, the base or what is
    checked out (`reviewKey`; a load
    that rebuilds the comments unchanged keeps it), when the text is
    generated afresh. Copy review copies a kept edit, as the preview
    would show it, and any copy drops it (`keptEdit`, `copyText`): the
    author's call, 2026-10-15, so a copy never leaves out what was typed.
    The text is read-only until it has arrived.
26. **Suggested code starts without its shared indent** (`suggestable`,
    `app/src/store.ts`): "Suggest code" fills the + lines with the
    commented lines less the leading whitespace they share, the red
    lines and a saved comment's card show them the same way, and the
    code is saved and sent as typed, with nothing added back. A
    suggestion saved before this, indent and all, is shown on its card and
    opened for editing without its shared indent too, so its − and +
    lines line up and unchanged code still needs a reason. While on,
    the button shows ✓ in place of ±, so its state is told by more than
    shade (HIG `accessibility`). The editable + line has no ring of its
    own, as the design draws it, against the HIG `focus-and-selection`
    page; the header's "Edit the + line" and the caret say it takes
    typing. The developer's call, 2026-10-14 (`ux` skill, "Where the
    developer chose against the HIG"). The agent
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
28. **The composer's range has handles** at its first line's top edge and
    its last line's bottom edge, over the line numbers, while the
    composer is open on lines. Dragging one down the gutter moves that
    end, inside the hunk (Decision 6), past the other end too; the draft
    is kept, and suggested code still as "Suggest code" made it follows
    the lines, while code the user changed stays (`resizeComposer`). The
    selection follows the pointer, and the composer reads the lines once,
    on release, as a drag-selection does. A drag released outside the
    window, where no mouseup reaches it, ends when the pointer comes back
    over the gutter with no button down, a drag-selection too. Each handle is a 4 px bar in a
    28 × 20 px target (HIG `accessibility`, minimum control size); the
    bar keeps the design's look, the developer's call, 2026-10-14. The
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
    | Alt-Return (Option), in the composer | Suggest code on or off |
    | E | Edit the open comment |
    | R | Resolve the open comment, which closes its card; R again unresolves it and opens the card; nothing on a draft never sent (ADR 0015 §4) |
    | ⌘/Ctrl-Backspace | Delete the open comment, with Undo |
    | ⌘/Ctrl-Z | Undo the last delete, Delete drafts or Re-place |
    | Shift-X | Show every unchanged line of the file |
    | ⌘/Ctrl-1 / ⌘/Ctrl-2 | Unified / Split |
    | ⌘/Ctrl-Shift-B | Open the base picker |
    | ⌘/Ctrl-Shift-P | Preview the instructions, with comments |
    | ⌘/Ctrl-Shift-C | Copy review, with comments |
    | ⌘/Ctrl-R | Check for changes now |
    | ⌘/Ctrl-Shift-W | Close the folder |
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
    gutter does. A selection made by keys shows the range's pill, "Comment
    on line N" for a single line, which a press on the gutter never leaves
    without the composer. None of them acts while a comment is being written,
    whose range moves only by its handles, or while the pointer drags.
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
    Return keeps it. Its open state, the preview's and why Copy review
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
    every sent card's Resolve button and in the macOS Review menu, which
    reads Unresolve when the open comment is resolved. While a lost draft
    is being placed, Return places it wherever focus was left, as the bar
    over the file says.

30. **A drag-selection opens the composer when released** (the design's
    flow 3d, as edited 2026-10-15; the developer's call, 2026-10-15), on
    the lines dragged over, as a single press does. Shift-click and
    Shift-↓ / Shift-↑ still leave a range with the "Comment on lines"
    pill, so a range can be adjusted before C. Until 2026-10-15 a drag
    left the pill too.

31. **The loop's states are drawn as the design's component sheet draws
    them** (ADR 0015; `app/src/components/Pin.tsx`, `CommentCard.tsx`,
    `ReviewActions.tsx`, `Sidebar.tsx`, `FilePane.tsx`):
    - **Pins** are 20 px continuous-corner squares: ink for a draft or a
      reopened comment, paper (a white disc on a hairline) for a sent
      one; an ink badge on paper says changed, a paper badge on ink says
      reopened; the open pin lifts with a halo. Beside a mark in a list,
      a card's chip or the round strip, the same look is a 10 px disc,
      where the design draws a small rounded square: that reads as an
      unticked checkbox beside Viewed (the author's call, 2026-10-16,
      under the developer's instruction of 2026-10-15 to run the review
      until clean; so for the pills below). Lost, resolved and
      outdated comments draw none. A copy turns the pins and list entries
      to paper top to bottom, 40 ms apart (`.pin` in `styles.css`, `--i`
      the comment's index).
    - **Cards:** a draft keeps Edit and Delete; a sent one shows its chip
      (Sent, Changed, Reopened), "Sent in round N · 18 min ago" (`when`,
      as the welcome screen's recent folders; in `muted3`, as "You sent in
      round N"), a reopened
      one "You sent in round N" with the old text and "Copies as “Still:
      …”" (the composer shows the same while editing a sent comment), a
      changed one "Lines 21–24 → line 23" or "Line 31 · code removed" with
      the sent (−) and now (+) code under the commits it was sent on and
      is now on, "a1f3c9e → 7c20d14", or "a1f3c9e → uncommitted" when no
      commit followed; then a footer ("Untouched since sent", "… · nearby
      lines changed", "Code changed since sent", "Code removed since
      sent", "Suggestion applied") with Edit and Resolve R, primary on a
      changed card; a draft's footer has Edit and Delete in the same
      place, where the design puts them in the header (ux gate 7).
      Resolving closes the card (a resolved comment has no
      pin); R, or the macOS menu's Unresolve, then unresolves that
      comment and opens its card again (`lastResolved`), until another
      comment is shown. Only ⌘/Ctrl-Backspace deletes a sent comment.
    - **The comment list** marks each entry (Sent, Changed in bold,
      Reopened, Code gone, Not in this diff) with its glyph, keeps a lost
      draft's first line of code with Re-place and Delete, offers Resolve
      (and no Delete) on a sent comment on no line here (its file left the
      diff, or another base or branch is shown: it has no card), Delete on
      a draft not in this diff, and
      folds the resolved ones into "Resolved (n)" at the bottom, each with
      Unresolve, which opens the card again only for a comment that has
      one. Its hint names "comments in this diff" only when one is not in
      this diff (`notInDiff`, as the count). Text the list mutes is in
      `muted3`, which reads at 4.5:1,
      and a focused entry is highlighted with an inset ring. Its footer
      has Preview instructions… and Delete drafts,
      the ellipsis since the dialog follows (HIG `buttons`).
      The count button counts open comments.
    - **The round strip** under the progress header (`roundStrip`,
      `app/src/round.ts`): "Nothing sent yet · 5 drafts"; "Round 2 sent ·
      5 comments · Just now" until the agent's work shows; then "Round 2 ·
      2 changed · 1 untouched · 1 resolved automatically", wrapping rather
      than cutting a count short. A count that steps N / P through its
      comments (`commentFilter`) is a filled pill, outlined while pressed,
      so it reads as a control (HIG `buttons`), where the design draws
      plain text; a second press steps through all again, and a count
      whose comments have no card opens the list. A copy clears the
      filter. A reopened comment counts in neither.
    - **Copy:** "✓ Copied · round 2 sent", "3 comments copied as
      instructions and marked Sent. Paste them into your agent session.",
      Preview instructions… (the list's words for the same dialog) and
      Not sent (ADR 0015 §1). The popover of a copy that sent a round
      stays until a load changes something, a comment is written, edited,
      deleted or resolved, or it is dismissed; one that sent nothing goes
      after 6 s, as does one whose round was recorded while a load or an
      edit moved the review on, so Not sent could not be offered.
      Not sent is drawn as the action it is, in the foreground weight. Copy review and the
      preview's Copy are disabled with no open comment. A comment changed
      while the round is recorded keeps its change and takes what was
      sent.
    - **Re-place** (ADR 0015 §2): from the list's Re-place, the lost
      draft's file is selected when the diff has it, a bar under the file
      header names the comment ("Re-place “…”", "Click a line number ·
      Esc", then "↑ ↓ to move · Return to place · Esc"), a dashed pin and a "Place here ↩" pill
      follow the pointer or the arrows (the list leaves focus on no
      control when it closes into placing), a click or Return places it, Esc
      leaves it lost, and the undo bar says "Placed on line 16. It is a
      draft again." with Undo. The bar's 10 s wait while the preview
      covers it and start over when it closes (HIG `undo-and-redo`;
      2026-10-16), so opening the preview never uses up an undo.

## Pitfalls

- A load answers for the comments it was sent. One changed while it ran
  (a handle drag, an edit) must keep its change: `reload` takes the
  load's version only of comments still the objects it sent, and leaves
  the rest for the next load. Until 2026-10-14 a comment moved during a
  load went back to where the load put it, keeping only its new text.

- Overlays (composer, comment card, range pill) live inside virtualized
  rows; their row is lifted with `z-index`, or the next row paints over
  them.
- Code rows have an integer line height (24 px, the v2 design's; 25 px
  until 2026-10-14); a fractional one leaves
  hairline gaps between measured rows.
- A native context menu needs the pointer's position (`showMenu` passes
  `clientX`/`clientY`): without one, GTK on Wayland opens it at a corner
  of the window.
- Muda's predefined Cut, Copy, Paste and Select All do nothing on Linux
  under Wayland (they send keys through libxdo, X11 only), so a context
  menu for text keeps the webview's own (Decision 19).

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
to a find bar not shown, Copy review left out a kept preview edit, that
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
