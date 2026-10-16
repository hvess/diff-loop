# diff-loop-core

The domain: what changed on a checkout, review comments, and the instructions they become.

**Status:** active — first version landed.
**Scope:** `crates/core`. Excludes reading git (`diff-loop-git.md`) and the UI (`diff-loop-app.md`).
**Owner:** Maximilian
**Last Updated:** 2026-10-16

## Why

The design's flows reduce to three pieces of logic that must not depend on
git or Tauri: which base to start from, keeping a comment on its code as
the agent changes the checkout, and writing the review as instructions.
Each is a pure function tested here.

## Steps

1. Types and the `Repository` port (`repository.rs`, `diff.rs`, `base.rs`) — done 2026-10-13.
2. `default_base` — done 2026-10-13.
3. `Role::of` and `group` — done 2026-10-13; removed 2026-10-14 (ADR 0013 §1).
4. `reanchor` — done 2026-10-13.
5. `instructions` — done 2026-10-13.
6. `open` and `load`, composing the above over a `Repository` — done 2026-10-13.
7. `lines`: a line range of either side of a file, for the unchanged lines a diff leaves out — done 2026-10-13.
8. The `ReviewStore` port and `SavedReview` (ADR 0004) — done 2026-10-13.
9. `update`, and `load` since the last load: read only what was touched (ADR 0005) — done 2026-10-13.
10. `BaseRef::behind` and `Repository::uncommitted_files`, for the base picker — done 2026-10-13.
11. Rounds (`rounds.rs`, ADR 0015): `end_round` sends every open comment with its code and context, and keeps the last 20 rounds — done 2026-10-15.
12. Judging a sent comment (`anchor.rs`, ADR 0015 §3), and comparing code with whitespace aside (`code.rs`, §7) — done 2026-10-15.

## Decisions

1. **Line numbers are 1-based and per side.** A `Line` is an enum, so a
   removed line cannot carry a new-side number.
2. **The default base** is the first that exists of: the remote's
   default branch (local copy first), `main`, `master`, `origin/main`,
   `origin/master`. The checked-out branch counts as existing; when it is
   the one found, or none exists, only uncommitted changes are compared.
3. **A line comment's range is its code.** `Target::Lines` holds a start
   and the commented lines; its last line is `Target::end`, so a range
   cannot disagree with its code. The front end keeps a range inside one
   hunk (diff-loop-app Decision 6).
4. **A comment stays on its code, not its line number.** `reanchor` keeps
   a draft where its saved `code` still is, moves it to the nearest run of
   consecutive lines that match (Decision 15 says how lines match), or
   marks it gone: *lost* when it was last seen under the base and branch
   loaded (`Comment::place`, set wherever it is found), *outdated*
   otherwise (ADR 0015 §2 and §8). A gone comment keeps its last position
   and code, and every load looks for it again: found, it is current.
   Nothing here deletes a comment; until 2026-10-15 the front end deleted
   one whose code went under the same base and branch.
5. **No roles** (ADR 0013 §1): the sidebar nests files by folder, in the
   front end. Until 2026-10-14 the core grouped files by a role read from
   the path.
6. **Instructions** group comments by file in the order given (the front
   end passes sidebar order); within a file, whole-file comments come
   first, then removed-line comments, then the rest, each by line. They
   quote the first non-blank line of code cut to 60 characters, and
   dedent suggestions into a fenced block named for the file's language;
   a comment with no text (suggested code alone) has no `: text`.
   They are Markdown, each file under a `###` heading, with no other
   format, no switch for the quoted code and no note (ADR 0013 §2).
   Since 2026-10-15 (ADR 0015 §6): resolved comments are left out; drafts
   and reopened comments come first, a reopened one's text as "Still: …",
   a lost one as "Code no longer in the diff, was `…`"; then, under
   "### Still open" with the round they were sent in, the sent comments
   still open, each file under `####`, a changed one with ", was L21–24"
   where its lines moved, a removed one as "Code removed since sent, was
   L31 `…`".
7. **`open` and `load` take any `Repository`, sized or not**, so the app
   can hold its adapter as `dyn Repository`.
8. **`load` returns only what the caller lacks.** Each file carries a
   signature (a hash of its `FileDiff`, valid within one run); a file
   whose signature matches one in `known` comes back as
   `ReviewFile::Unchanged`.
9. **The port can watch** (`Repository::watch`, ADR 0002): an adapter
   reports what it touched (ADR 0005 §1).
10. **`lines` reads through `Repository::blob`**, so the port needs no
    new method; it splits as `str::lines` does, like the diff (Pitfalls).
    A range past the file's end returns what exists.

11. **A review is kept per working tree** (`ReviewStore`, ADR 0004 §1):
    its comments and, since 2026-10-15, its rounds (ADR 0015 §9), whatever
    the base; no note since ADR 0013 §3. An empty `SavedReview`, with
    neither, removes the entry.

12. **`load` since the last load reads only what was touched**
    (`update`, ADR 0005 §3), by their top-level directories past
    `MOST_PATHS`, and everything when the snapshot moved or the watch lost
    track; a new addition or deletion is read again with the opposite kind
    already held, so a staged addition pairs with a deletion as a rename,
    and past `MOST_PATHS` in all everything is read (ADR 0018 §2,
    `halves`). It then takes
    no fingerprint, and keeps the signatures of files it did not read
    again. `Loaded` is opaque: only `load` makes one.

13. **"Behind" is `git status`'s sense:** `BaseRef::behind` counts the
    ref's commits the checkout lacks. The design shows only
    "behind". The developer's call, 2026-10-13.
14. **A sent comment is judged where it was sent** (ADR 0015 §3 and §8,
    `anchor::judge`): under the base and branch of its `Sent::place`,
    or for the uncommitted changes as ADR 0017 §1 says (below),
    the two runs of context recorded either side of it (`CONTEXT`,
    three) are looked for bracketing some code, each `before` match
    paired only with the first `after` match past it in the same run of
    the diff, so the cost is O(m log m) in the m matches (`between`), cut down a line at a
    time from their far ends until a pair is found, the pair nearest the
    sent line with the least between; when what lies between is the
    suggestion (dedented, by Decision 15), the comment is *applied* and
    targets it,
    judged before the sent code is looked for, since a suggestion that
    keeps a sent line would otherwise read as that line. Else its sent
    code is looked for as a draft's is; found, it is *untouched* when its
    context is still there, in one run of the diff, else *nearby
    changed*. Not found, what the context brackets is the comment's
    target now: *removed* when empty, else *changed*.
    Neither found, it is *removed* at the diff's line nearest its last,
    with no code; with its file gone from the diff, *removed* and
    outdated, since there is no line to put it on. One run of context alone cannot bound the lines, so a
    comment sent at a hunk's edge is only ever untouched, nearby changed
    or removed.
    Elsewhere it is found by its current target as a draft is, and
    carries no verdict; sent against the uncommitted changes, it is
    judged only at the commit it was sent on, or with that commit as the
    base by its full id (ADR 0017 §1, `Sent::judged_at`). A sent comment resolves itself once when its
    verdict becomes applied from another known verdict;
    `Resolution::SuggestionApplied`.
15. **Whitespace alone is not a change** (ADR 0015 §7, `code::same_code`):
    lines match with trailing whitespace trimmed and a run of leading
    whitespace counting only as present or absent, in `reanchor` and the
    judgement alike.
16. **A round ends with a copy** (ADR 0015 §1, `rounds::end_round`); a
    commit on top of one sent against the uncommitted changes is followed
    for the newest with an open comment (`rounds::round_to_follow`, ADR
    0017 §2). Every
    unresolved comment is sent in a new round, numbered on from the last,
    with its target, text and suggestion as sent and up to `CONTEXT`
    lines either side of its code, read from the changed files the caller
    passes, each run stopping at a gap the diff leaves out; a comment
    whose file was not passed, or that is not on its code (lost,
    outdated, or judged removed and so on no code), is sent without
    context: bracketing the line where its code was would read that
    line as the code on the next load. `merge` folds a saved review
    into the window's once a failed read is read again (ADR 0004 §5):
    saved comments the window lacks are added, rounds copied meanwhile
    count on from the saved ones with their comments following, and the
    bound holds. With nothing
    unresolved, nothing changes. A lost comment sent is outdated. The
    last 20 rounds are kept
    (`KEPT_ROUNDS`): an older one drops with the resolved comments sent
    in it.

## Pitfalls

- A suspended judgement (ADR 0015 §8) clears the verdict, so "applied
  on the way in" is read only from a known verdict (`judged`): back from
  another base or branch, a comment the reviewer unresolved while applied
  stays unresolved. The cost is that a suggestion applied while the
  judgement was suspended does not resolve itself; the reviewer resolves
  it.
- `Line` text excludes the line ending, and git's `\r` is stripped with
  it (`str::lines`); comparisons in `reanchor` rely on both sides being
  read the same way.

## Progress (2026-10-16, a rename's other half)

ADR 0018 §2: `update` reads a new addition or deletion with the opposite
kind already held (Decision 12).

## Progress (2026-10-16, a commit on top of a round)

ADR 0017: `reanchor` takes the commit at `HEAD`, and a comment sent
against the uncommitted changes is judged at its commit (Decision 14);
`round_to_follow` names the round a commit on top is followed for
(Decision 16).

## Progress (2026-10-15, rounds and resolution)

Steps 11 and 12 landed (ADR 0015): `Comment` carries where it was last
seen, what it was sent on and how it was resolved; `reanchor` marks a
draft lost or outdated and judges a sent comment (Decisions 4, 14 and 15);
`end_round` records a round (Decision 16); the instructions gain "Still
open" (Decision 6); `SavedReview` holds rounds (Decision 11).

## Progress (2026-10-14, the v2 design)

Roles, the instructions' format and include-code switch, and the saved
note were removed (ADR 0013); Decisions 5, 6 and 11 say what holds now.

## Progress (2026-10-13, comments deleted when their code changes)

An outdated comment is looked for again on every load (Decision 4).

## Progress (2026-10-13, the base picker's notes)

Step 10 landed.

## Progress (2026-10-13, reading only what was touched)

Step 9 landed (ADR 0005).

## Progress (2026-10-13, reviews kept between runs)

Step 8 landed with the app's `JsonReviews` adapter.

## Progress (2026-10-13, expanding unchanged lines)

Step 7 landed with the app's "Show N unchanged lines".

## Progress (2026-10-13, first version)

The crate and its tests landed with the Tauri app and the git adapter.
