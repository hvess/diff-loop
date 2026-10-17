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

Diff Loop has no design system yet. When one is adopted, it becomes the
authority for visual values — colour, type, spacing — and the HIG stays the
authority for behaviour:

| Question | Authority |
|---|---|
| Is it intuitive, familiar, predictable, forgiving? What happens on a key, a click, an error? What does the text say? | **HIG** |
| Which colour, typeface, spacing, icon? | **The design system**, once adopted |

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
   own control.
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
- **A folder folds by its icon, with no disclosure triangle** (diff-loop-app
  Decision 23; the developer's call, 2026-10-16). The HIG
  `disclosure-controls` page shows a folder hierarchy revealed by
  disclosure triangles, pointing inward when hidden and down when shown,
  and the `sidebars` page groups hierarchy with disclosure controls. The
  developer chose the v2 design, which draws only the open or closed
  folder icon; a folded folder also says how many files it holds.
- **The design's pale greys stay, for now** (the developer's call,
  2026-10-14; open-tasks 16). The HIG `accessibility` page asks for
  4.5:1 contrast for text; `--ui-faint` and `--ui-muted` draw line
  labels, the suggestion box's header and viewed files' names below it,
  and since 2026-10-17 the base picker's search placeholders, a
  remote's prefix and the dimmed checked-out branch.
- **The base picker's lists look as the design draws them**
  (diff-loop-app Decision 32; the developer's call, 2026-10-17). The
  HIG `writing` page warns against abbreviations people may not know,
  and `layout` asks that items align for scanning; the design ends a
  ref's row with a short age ("5m", "3mo", the full date on hover), and
  puts a list row's count before its ›, not in line with the trails
  above it. Its first list has no headings: the HIG `menus` page groups
  related items under a title, and without one "Last commit", which
  narrows the diff, sits beside the default branch, which is a base;
  the design relies on the order and the "Default" trail. It is a list
  in a popover with its own search, not a menu, so its rows take the
  app's sentence case ("Last commit", "Local branches"), not the
  title case HIG `menus` asks of menu items. Its search field, which
  holds focus while the picker is open, is drawn flat, with no focus
  ring (HIG `focus-and-selection`); the highlighted row shows where
  Return goes.
- **The range handles look as the design draws them** (diff-loop-app
  Decision 28; the developer's call, 2026-10-14): a 4 px bar on the
  row's edge, in a 28 × 20 px target. The HIG `accessibility` page asks
  for controls that are easy to see and hit; the target meets its size,
  the bar is the design's.
- **The sidebar's progress ring stays** (diff-loop-app Decision 24; the
  developer's call, 2026-10-14). The HIG `progress-indicators` page keeps
  a determinate ring for an operation under way; the design uses one as
  a lasting meter of the lines reviewed, with the count beside it in
  words.
- **The editable + line has no ring of its own** (diff-loop-app Decision
  26; the developer's call, 2026-10-14). The HIG `focus-and-selection`
  page asks for a focus ring on a text field; the v2 design draws the
  editable + line like the code around it, and says "Edit the + line"
  in the box's header, with the caret in the line.
- **The preview's text looks like the code panels until it has focus**
  (diff-loop-app Decision 25; the developer's call, 2026-10-14). The HIG
  `entering-data` page asks that a field look like one; the v2 design
  draws the instructions as a panel, and its footer says "You can edit
  the text before copying." Focused, it has the focus ring.
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
- **Alt-Return (Option-Return) turns Suggest code on or off in the
  composer** (diff-loop-app Decision 29; the developer's call,
  2026-10-15). The HIG `keyboards` page says to prefer a modifier other
  than Command only with alphabetic characters, and in a text field
  Option-Return otherwise types a line break. The developer chose it
  for Suggest code; Return alone still types the line break.
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
  the hints already there (V on Viewed, C on the range pill, N / P in the
  comments list, R on a sent card's Resolve, ⌘/Ctrl-↵ on the preview's
  Copy) stay.
- **"Not sent" names a state, not a verb** (ADR 0015 §1; the design's
  red-pen note 02, the developer's call, 2026-10-15). The HIG `writing`
  page prefers a verb on a button; the popover's second action keeps the
  design's "Not sent", which says what it makes true of the round.
- **The preview's footer keeps its own words** (diff-loop-app Decision
  25; the developer's call, 2026-10-15). The design as edited 2026-10-15
  says "Click into the text to edit before copying.", "Changes apply to
  this copy only." and "Reset"; the app keeps "You can edit the text
  before copying.", "Edits change this text, not your comments." and
  "Reset to original", which say what the edit touches and what Reset
  goes back to (HIG `writing`).
- **The preview has a ✕ as well as Cancel** (diff-loop-app Decision
  25; the developer's call, 2026-10-15). The HIG `modality` page asks
  for one obvious way to dismiss a modal view and warns against a
  second control that could be taken for it; the design as edited
  2026-10-15 draws a ✕ in the dialog's header and Cancel in its
  footer, both closing it and keeping any edit, and the app follows
  the design.

## Settled wording

Wording the developer has decided. Judge it against the gate, not
against other wording that would also do.

- **Comments whose code is not in the diff** (diff-loop-app Decision
  16; the developer's call, 2026-10-14). One term, "not in this diff",
  everywhere: the comment count ("2 comments (1 not in this diff)"),
  the list chip ("Not in this diff"), the list hint ("N / P to jump
  between comments in this diff"), and the banner.
- **The banner's detail** (diff-loop-app Decision 16; the developer's
  call, 2026-10-15). One sentence, only when it holds: "2 comments are
  not in this diff." A banner names only a context change ("Switched to
  agent/share-retry", "The branch moved: 2 new commits", "The branch was
  rewritten"); nothing says the agent updated the code, and nothing is
  removed (ADR 0015 §10). Following a commit on top of a round, the
  title adds "· showing changes since round 3 (a1f3c9e)", the commit
  the base picker names, and its action is "Show
  uncommitted changes" in place of "Show what changed" (ADR 0017 §2; the
  author's wording under the developer's instruction of 2026-10-16 to
  fix every open task). Until 2026-10-15 it counted comments
  "addressed and removed", with "Undo removal".
- **A comment's marks** (ADR 0015; the design's words, the developer's
  call, 2026-10-15). In the list: "Sent", "Changed", "Reopened", "Code
  gone", "Not in this diff", "Resolved" and "Resolved · suggestion
  applied". On a card: the chip repeats the mark, and the footer says
  "Untouched since sent", "Untouched since sent · nearby lines changed",
  "Code changed since sent", "Code removed since sent", "Suggestion
  applied" or "Copies as “Still: …”". In the round strip: "Nothing sent
  yet", "Round 2 sent", "N changed", "N untouched", "N resolved
  automatically". The copy says "✓ Copied · round 2 sent" and "… copied
  as instructions and marked Sent."; its actions are "Preview
  instructions…", as the list's, and "Not sent"; the list's clearing is
  "Delete drafts". Placing a lost draft again is "Re-place",
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
  developer's call, 2026-10-17): "Search branches, tags or commits",
  where the design says "SHAs", and the typed row "Compare with “…”".
