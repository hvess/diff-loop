# 0013 — The v2 design: a tree, and instructions edited in place

**Status:** accepted, 2026-10-14
**Amends:** ADR 0001 §5 (the `diff-loop.prefs` key); ADR 0004 §1, §3, §4
and §5 (the general note)
**Affects:** `docs/spec/diff-loop-core.md`, `docs/spec/diff-loop-app.md`;
`crates/core` (`role.rs` removed, `instructions.rs`, `saved.rs`,
`review.rs`), `app/src` (`tree.ts`, `store.ts`, `PreviewDialog.tsx`)

## Context

The design moved on to "Agent Review v2.dc.html" (claude.ai/design
project `df71ed5c-a97b-4293-a1f7-f31eb6b93f9b`). Its sidebar is the
changed files nested in their folders, not grouped by role, and its rows
carry no captions. Its instructions preview has no format switch and no
toggles: the text is Markdown with the code quoted, and is edited in place
for that copy. It has no field for a general note. The developer chose to
follow the design in each, 2026-10-14.

## Decision

1. **The sidebar is a tree, built in the front end** (`app/src/tree.ts`)
   from the review's paths: presentation, not a domain rule. The core's
   roles go with the groups they made: `Role`, `FileGroup`, `group` and
   `Review::groups` are removed, and the front end's captions with them
   (`links.ts`).
2. **Instructions are always Markdown and always quote code.**
   `InstructionsRequest` loses `format`, `include_code` and `note`, and
   `Format` is removed. Text typed over the preview's applies to that copy
   only; Reset to original discards it.
3. **There is no general note.** `SavedReview` holds only comments. A
   `note` in a `reviews.json` written earlier is ignored when read and
   dropped at the next save; the format stays version 1, since such a
   file still parses. An earlier build reading a file written now finds
   no `note`, reports the file unreadable and leaves it alone (ADR 0004
   §3).
4. **No instruction preferences are kept.** `diff-loop.prefs` is no
   longer read or written; a value an earlier version left stays in
   `localStorage`, unused. `diff-loop.recent` is the one key (ADR 0001
   §5).

## Consequences

- Saving is per change to the comments only; the 300 ms wait for typing
  in the note (ADR 0004 §4) goes with it.
- An agent that needs a general instruction gets it by editing the
  preview's text before copying.
