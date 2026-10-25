# 0035 — The switcher lists the project's branches

**Status:** accepted, 2026-10-25
**Amends:** ADR 0026 §7 (the review switcher: every project's reviews, live or committed only, the last row opening a folder); ADR 0033 §4 (the switcher listing every project's reviews)
**Affects:** `docs/spec/diff-loop-app.md` (Decisions 29, 33 and 35), `docs/spec/diff-loop-core.md` (Decision 19); `crates/core` (`ReviewSummary`, `ProjectCheck`; `RoundSummary` and `CheckedReview` removed; `Project::commits_between` removed, with `crates/git`'s); `app/src-tauri/src/lib.rs` (`KeptReview`, `kept_reviews`), `claims.rs` (`held_elsewhere` removed); `app/src/switcher.ts`, `components/Switcher.tsx`, `components/ReviewScreen.tsx` (`LiveDot` removed); the canvas's 6a and 6b

## Context

ADR 0026 §7 made the window's switcher a list of every kept review, this
project's first and then every other project's, each row marked live in a
worktree or committed only, with its open comments, its last round and
whether its branch moved, and a last row opening a folder. The developer
found it the wrong tool (2026-10-25): what is wanted from the title bar's
chip is another branch of the project open, and other projects are opened
from Open Folder… or Welcome. The canvas's 6a and 6b were redrawn so.

## Decision

1. **The switcher lists the open project's branches only**, in the base
   picker's popover: no other project, and no row opening a folder.
2. **It opens on Recent**: up to 8 branches, the one shown first and
   checked, then the project's reviews by when each was last shown, then
   its local branches by their last commit. Each row is the branch's
   name, its review's open comments as a badge when it has any, and its
   last commit's age.
3. **Under Recent, Local Branches and each remote open their list in
   place**, as the base picker's lists do (Decision 32 of the app's
   spec). Typing searches every local and remote branch, grouped by list.
4. **No symbol marks a branch live or committed only**, here or on the
   chip, which always draws the branch symbol; the chip's tooltip still
   says why a branch read from its commits alone is limited (Copy is not
   offered there, ADR 0026 §3). There is no Previous Review. A branch with no review opens without
   starting one; its review begins with the first comment (ADR 0026 §2).
5. **The core gives the switcher only what it shows**: a kept review's
   summary is its open comments and when it was last shown, and a
   project's check is its branches and the reviews whose branch is gone.
   The round summary, the total count, whether another window shows a
   review, and how far each review's branch moved are no longer read or
   computed, and the `Project` port no longer counts commits.

All the developer's calls, 2026-10-25.

## Consequences

- A review another window shows is no longer said in the switcher's row;
  picking it still says so at the switcher's top (ADR 0026 §9).
- A branch that moved since its review was last shown is said by the
  banner when it is opened (ADR 0026 §4), not in the list.
- The check no longer counts commits per review, one git call fewer for
  each review whose branch moved.
