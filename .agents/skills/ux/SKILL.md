---
name: ux
description: The usability bar for Diff Loop's interface, with Apple's Human Interface Guidelines as the only reference for usability and interaction. Use when designing, building, changing or reviewing anything the user sees or operates — a window, a view, a key binding, a menu, a message, a flow.
---

# UX

Your job is the quality and usability of the application. An interface is
built for humans, not machines, and the bar is this: **someone already knows
how to use it without having to learn it.** If a flow needs explaining, the
flow is wrong; fix the flow, not the explanation.

## The authority

**Apple's Human Interface Guidelines are the only reference for usability
and interaction.** When designing, creating or changing an interface, justify
decisions from the HIG and nothing else — not other design systems, not
other apps, not your own taste.

Diff Loop's design system is the redesign canvas (ADR 0027): it is the
authority for visual values — colour, type, spacing — and the HIG stays the
authority for behaviour:

| Question | Authority |
|---|---|
| Is it intuitive, familiar, predictable, forgiving? What happens on a key, a click, an error? What does the text say? | **HIG** |
| Which colour, typeface, spacing, icon? | **The design system**: the redesign canvas (ADR 0027) |

Where the two disagree, do not quietly pick one: record the disagreement
with both halves and which the app follows, and tell the developer.

Read the HIG pages themselves; do not work from memory of them. The pages are
at `https://developer.apple.com/design/human-interface-guidelines/<page>`,
and their text can be fetched as JSON from
`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`.

## The principles

The HIG's design principles (`design-principles`), each the HIG's own
sentence, and what each means for this app:

- **Familiarity — "Build on what people know."** The most important one
  here. Use the controls and shortcuts a desktop user already has in their
  hands: Return confirms, Esc cancels or backs out, ⌘/Ctrl-Z undoes,
  ⌘/Ctrl-, opens settings, Tab moves focus, the platform's own menu bar and
  window controls. A new binding for something that already has a
  convention is a defect.
- **Simplicity — "Be clear and direct."** One obvious way to do each thing.
  Every element on screen has to earn its place.
- **Agency — "Let people do things their own way."** The user stays in
  control: nothing irreversible happens without their say, and they can
  always back out.
- **Responsibility — "Act in people's best interest."** Never surprise,
  never lose work, never hide what the app did.
- **Flexibility — "Adapt to diverse contexts and needs."** Small and large
  windows, light and dark appearance, keyboard and pointer, macOS, Windows
  and Linux conventions where they differ.
- **Purpose — "Make something meaningful."** Each view exists for one job.
- **Craft — "Care about every detail."**
- **Delight — "Make it human."**

## Pages to read by task

Read the relevant one before starting the task.

| Task | HIG page |
|---|---|
| Any text on screen: labels, messages, errors, empty states | `writing` |
| Key bindings, shortcuts | `keyboards` |
| Menus, the menu bar, context menus | `the-menu-bar`, `menus` |
| Pointer, clicks, drags, selection | `pointing-devices`, `focus-and-selection` |
| Something is running or waiting | `feedback`, `loading`, `progress-indicators` |
| A sheet, dialog or alert | `modality`, `alerts` |
| Anything reversible or destructive | `undo-and-redo` |
| Text entry | `entering-data` |
| Search, pickers, lists | `searching`, `lists-and-tables` |
| Windows, split views, sidebars | `windows`, `split-views`, `sidebars` |
| First launch | `launching`, `onboarding` |
| Help, discoverability of commands | `offering-help` |
| Configuration | `settings` |
| Light and dark | `dark-mode` |
| Contrast, colour-blindness, keyboard-only use | `accessibility` |
| Spacing, alignment, hierarchy | `layout`, `typography` |

## The gate

Before calling an interface change done, every line below must hold. Report
each as **pass** or the specific failure.

1. **No learning required.** Someone who has never seen this view knows
   what it is for and what to do next within a glance.
2. **Familiar controls.** Every key and pointer action does what it does in
   other desktop apps on that platform. Anything new is justified by a HIG
   page.
3. **Always a way out.** Esc (or the documented equivalent) leaves every
   modal state, and leaving loses nothing unexpectedly.
4. **Feedback for everything.** Every action gets a visible response;
   anything that takes time shows that it is running.
5. **Errors say what happened and what to do.** In plain language, per
   `writing` — "Write clear error messages".
6. **Nothing destructive by accident.** Irreversible actions need a
   deliberate step; reversible ones can be undone. Nothing removes a
   comment but the reviewer (ADR 0015): a load marks one lost or
   outdated, a copy sends it, and R resolves it, each undone by its
   own control. Two removals are git's, not the window's, and are said
   once with no undo (ADR 0026 §4 and §6, the developer's calls,
   2026-10-19): a branch deleted takes its review and comments with it,
   and a rewrite takes the rounds sent on the commits it replaced; each
   follows a deletion already made outside the app.
7. **Consistent.** The same thing looks, reads and behaves the same
   everywhere in the app.
8. **Accessible.** Readable in light and dark, and meaning never carried
   by colour alone.
9. **Checked by use, not by reading the code.** Run the app and walk the
   flow as a first-time user would.

## Where the developer chose against the HIG

The HIG stays the authority for behaviour; these are the developer's
own decisions to depart from it, each recorded with both halves.

- **The sidebar's tree nests as deep as its folders** (diff-loop-app
  Decision 23; the developer's call, 2026-10-14). The HIG `sidebars`
  page says to show no more than two levels of hierarchy. The developer
  chose the v2 design's tree, which nests changed files as deep as their
  folders go: only changed paths are listed, chains of lone folders read
  as one row, and since 2026-10-15 each folder folds on a click (ADR
  0016).
- **Two notes in popovers, as the design draws them** (diff-loop-app
  Decision 33; the developer's call, 2026-10-19). The HIG `popovers`
  page advises against a warning in a popover and against one covering
  content: a deleted branch's notice (6k) is said at the review
  switcher's top, which Esc closes, and "Review Saved" (6e) hangs from
  the title bar's chip over the sidebar's head for 6 s or until
  Dismiss. The deletion is git's, already made. "Review Saved" draws
  no arrow, as the canvas draws none for it; the popovers that open
  from a control point at it (ADR 0027).
- **A comment's popover covers the lines under its range** (diff-loop-app
  Decision 35; the developer's direction, 2026-10-22). The HIG
  `popovers` page advises against covering content people need; the
  canvas hangs the composer and a comment under the range's last line,
  its arrow's tip on that line's edge, over the lines below, so the
  commented lines stay in view. Esc or a click on the gutter closes it.
- **Split cuts long lines with a fade** (diff-loop-app Decision 35; the
  developer's direction, 2026-10-22). The HIG `layout` page asks that
  content stay legible; the canvas's Split ends each column's code in a
  24 px fade at its edge, which says it goes on, and its comment marks
  sit at the right edge over the code; Unified, which wraps, shows the
  whole line.
- **Long places are cut at their end** (the canvas's 1a and 6a; the
  developer's direction, 2026-10-22). macOS cuts a path in the middle;
  the canvas cuts a review's place line at its end, and the whole of it
  is in the line's tooltip.
- **A review open in another window is not brought forward** (ADR 0026
  §9; the developer's call, 2026-10-19; open-tasks 25). Desktop apps
  bring forward a document already open; each Diff Loop window is its
  own process, and Wayland refuses one app focusing another's window,
  so the switcher says where it is instead: "Look for “drive-web ·
  agent/share-retry” in your window list."
- **The base picker's lists look as the design draws them**
  (diff-loop-app Decision 32; the developer's call, 2026-10-17). The
  HIG `writing` page warns against abbreviations people may not know,
  and `layout` asks that items align for scanning; the design ends a
  ref's row with a short age ("5m", "3mo", the full date on hover), and
  puts a list row's count before its ›, not in line with the trails
  above it. Uncommitted Changes ends with its line counts in green and
  red, "+4 −1", as the file's header writes them, with no word for what
  they count. Its first list has no headings: the HIG `menus` page groups
  related items under a title, and without one "Last Commit", which
  narrows the diff, sits beside the default branch, which is a base;
  the design relies on the order and the "Default" trail. It is a list
  in a popover with its own search, not a menu; its rows take the
  canvas's title case ("Last Commit", "Local Branches"), as every label
  does (ADR 0027 §7). Its search field, which
  holds focus while the picker is open, is drawn flat, with no focus
  ring (HIG `focus-and-selection`); the highlighted row shows where
  Return goes. The review switcher's field is drawn the same way, so
  the two read alike (the developer's call, 2026-10-20).
- **A range's ends drag from the gutter, with no handles** (diff-loop-app
  Decision 35; the developer's direction, 2026-10-22): while the
  composer is open, the range's first and last gutter rows take the
  drag, with the resize cursor, as the canvas draws it. The HIG
  `accessibility` page asks for controls that are easy to see and hit;
  each is a whole row of the gutter, 80 px wide.
- **The progress ring stays, in the bottom bar** (diff-loop-app
  Decisions 24 and 35; the developer's call, 2026-10-14). The HIG `progress-indicators` page keeps
  a determinate ring for an operation under way; the design uses one as
  a lasting meter of the lines reviewed, with the count beside it in
  words.
- **The preview's text has its focus ring only while focused**
  (diff-loop-app Decisions 25 and 35; the developer's call, 2026-10-14).
  The HIG `entering-data` page asks that a field look like one; the
  canvas's sheet draws the instructions as an inset panel with a hairline,
  and its note says "Edits change this text, not your comments." 
- **Most review shortcuts are single keys** (diff-loop-app Decision 29;
  the developer's call, 2026-10-15). The HIG `keyboards` page prefers
  Command as the main modifier of a custom shortcut, and warns that many
  new shortcuts make an app seem hard to learn. The developer chose
  single keys for the review's most frequent moves (J / K, N / P, V, C,
  E, Shift-X) and arrows for the line cursor; none of these acts in a
  text field.
- **⌘/Ctrl-Shift-B opens the base picker** (diff-loop-app Decision 29;
  the developer's call, 2026-10-15). The HIG `keyboards` page says to
  avoid adding a modifier to an existing shortcut for an unrelated
  command, and ⌘B is Bold; no field in the app formats text.
- **Alt-Return (Option-Return) turns Suggest Change on or off in the
  composer** (diff-loop-app Decision 29; the developer's call,
  2026-10-15). The HIG `keyboards` page says to prefer a modifier other
  than Command only with alphabetic characters, and in a text field
  Option-Return otherwise types a line break. The developer chose it
  for Suggest Change; Return alone still types the line break.
- **⌘/Ctrl-Shift-C copies the review and ⌘/Ctrl-Shift-P opens its
  preview** (diff-loop-app Decision 29; the developer's call,
  2026-10-15). The HIG `keyboards` page lists them as Show Colors and Page
  Setup, and allows redefining a standard shortcut whose action makes no
  sense in the app; Diff Loop has neither a colour panel nor printing.
- **The new shortcuts are not shown on the controls they drive**
  (diff-loop-app Decision 29; the developer's call, 2026-10-15; open
  task 17). The HIG `offering-help` page offers tips and tooltips to help
  people "discover faster ways to accomplish a task". The developer chose
  to build the keys first and show them later, in a list of their own;
  the hints already there (V on Viewed, R on a sent card's Resolve, ⌘/Ctrl-↵ on the preview's
  Copy) stay.
- **"Not Sent" names a state, not a verb** (ADR 0015 §1; the design's
  red-pen note 02, the developer's call, 2026-10-15). The HIG `writing`
  page prefers a verb on a button; the popover's second action keeps the
  design's "Not Sent", which says what it makes true of the round.
- **The preview's footer is the canvas's** (diff-loop-app Decisions 25
  and 35; the developer's direction, 2026-10-22): "Edits change this
  text, not your comments." with what copying ends, Reset to Original
  once the text is edited, Cancel and Copy to Clipboard. It has no ✕:
  Esc and Cancel close it, one way to dismiss it as the HIG `modality`
  page asks.

## Settled wording

Wording the developer has decided. Judge it against the gate, not
against other wording that would also do.

- **Comments whose code is not in the diff** (diff-loop-app Decision
  16; the developer's call, 2026-10-14). One term, "not in this diff",
  everywhere: the comment count ("2 comments (1 not in this diff)"),
  the list chip ("Not in this diff"), and the banner.
- **The banner's detail** (diff-loop-app Decision 16; the developer's
  call, 2026-10-15). One sentence, only when it holds: "2 comments are
  not in this diff." (The banners of a review's own context in ADR 0026,
  below, carry the design's two or three sentences instead.) A banner
  names only a context change ("The branch
  moved: 2 new commits", "The branch was rewritten"; "Switched to
  agent/share-retry" until ADR 0026, when a switched worktree became
  ".wt/share-rate-limit now has agent/share-retry checked out", with
  "agent/share-retry moved since you last looked" and "… was rewritten
  while you were away" on returning to a review, the design's words for
  flow 6); nothing says the agent updated the code, and nothing is
  removed (ADR 0015 §10). Following a commit on top of a round, the
  title adds "· showing changes since round 3 (a1f3c9e)", the commit
  the base picker names, and its action is "Show
  Uncommitted Changes" in place of "Show What Changed" (ADR 0017 §2; the
  author's wording under the developer's instruction of 2026-10-16 to
  fix every open task). Until 2026-10-15 it counted comments
  "addressed and removed", with "Undo removal".
- **A comment's marks** (ADR 0015; the design's words, the developer's
  call, 2026-10-15). In the list: "Sent", "Changed", "Reopened", "Code
  gone", "Not in this diff", "Resolved" and "Resolved · suggestion
  applied"; since ADR 0032, "Resolved by agent", with the agent's note
  as "Agent: …" and Accept in place of Resolve, the margin note reading
  "Agent: <note>" ("Agent: Resolved" with none), and the round strip's
  "2 resolved by agent, to accept", which the comment count's "2
  comments, 2 to accept" repeats (the developer's call, 2026-10-25). On a card: the chip repeats the mark, and the footer says
  "Untouched since sent", "Untouched since sent · nearby lines changed",
  "The code changed after you sent this. Resolve it if the change
  answers you." (the canvas's; "Accept it" once the agent resolved
  it, the developer's call, 2026-10-25), "Code removed since sent", "Suggestion
  applied" or "Copies as “Still: …”". In the round strip: "Nothing sent
  yet", "Round 2 sent", "N changed", "N untouched", "N resolved
  automatically". The copy says "Copied · round 2 sent" and "… copied
  as instructions and marked Sent."; its actions are "Preview
  Instructions…", as the list's, and "Not Sent"; the list's clearing is
  "Delete Drafts". Placing a lost draft again is "Re-place",
  ADR 0015 §2's word and the design's; its bar says "Re-place “…”" and
  its undo bar "Placed on line 16. It is a draft again." In the
  instructions, "Still: …" prefixes a reopened comment's new text and
  "Still open" heads the sent comments not resolved yet, both ADR 0015
  §5 and §6's words: the one is the reviewer's repeat, the other the
  agent's leftover.
- **The reason for suggested code** (diff-loop-app Decision 22; the
  developer's call, 2026-10-14). The composer's text field has no label:
  its placeholder says what it needs, "Why this change? (optional)"
  while the code differs from its lines and "Change the code, or say
  why" while it does not. Once the field holds text, Comment is enabled
  whatever the code, so nothing is left to explain when the placeholder
  goes; the HIG `text-fields` advice to add a separate label is passed
  over here.
- **The base picker's search** (diff-loop-app Decision 32; the
  developer's call, 2026-10-17; title case since ADR 0027 §7): "Search
  Branches, Tags, or Commits",
  where the design says "SHAs", and the typed row "Compare with “…”".
- **Projects and folders** (ADR 0026; the design's words, the
  developer's call, 2026-10-19): Welcome's "Open Folder…" (the canvas's 1a),
  and since ADR 0033 its "Recent Projects", each row a project's name
  and folder.
  A project is what is
  reviewed, its branches' reviews together; a folder is what is picked
  to open one.
- **Reviews per branch** (diff-loop-app Decision 33; the developer's
  call, 2026-10-19, over the design's flow 6 words): "Comments follow
  their code." where the design said "re-anchored"; one phrasing for a
  branch no worktree has, "feature/old-export isn’t checked out in any
  worktree.", in Copy's note ("… Check it out in one to send its
  comments."), the base picker's reason ("… Check it out in one to
  compare with its uncommitted changes.") and the switched banner, and the
  detached banner's "… Check out a branch to comment.", each with its
  next step; "Open without saving" on a branch row, to match "↩ Open";
  "Review Saved" with "… is with your reviews now, under ⌘K." (Ctrl+K
  off macOS), as no window names a switcher; notices
  closed by "Dismiss", as banners' close buttons are named.
- **What git removed** (ADR 0026 §4 and §6; the design's words, the
  developer's calls, 2026-10-19): "agent/pdf-preview was deleted" with
  "Its review and 2 comments were deleted with it. There is no copy to
  restore.", and on returning to a rewritten branch "Round 1 was sent on
  commits that are gone and was deleted."; the banner's "nothing is
  removed" (above) is the window's own loads.
