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
   deliberate step; reversible ones can be undone. One exception: a
   comment whose code changed is deleted with no undo and no warning
   first (diff-loop-app Decision 16), the developer's call, 2026-10-13.
   It disagrees with the HIG `undo-and-redo` page (people expect to
   undo what they did), the `feedback` page (warn before unexpected,
   irreversible data loss), the Agency and Responsibility principles
   above, and line 7, since a comment deleted by hand keeps its undo;
   the app follows the exception.
7. **Consistent.** The same thing looks, reads and behaves the same
   everywhere in the app.
8. **Accessible.** Readable in light and dark, and meaning never carried
   by colour alone.
9. **Checked by use, not by reading the code.** Run the app and walk the
   flow as a first-time user would.

## Settled wording

Wording the developer has decided. Judge it against the gate, not
against other wording that would also do.

- **Comments whose code is not in the diff** (diff-loop-app Decision
  16; the developer's call, 2026-10-14). One term, "not in this diff",
  everywhere: the comment count ("2 comments (1 not in this diff)"),
  the list chip ("Not in this diff"), the list hint ("N / P to jump
  between comments in this diff"), and the move banner. The banner
  gives one sentence per group, each with "comment" as its subject:
  "1 comment was deleted because its code changed: share.ts:2 “Read
  the limit from config”.", "1 comment is not in this diff.", "1
  comment still applies."
