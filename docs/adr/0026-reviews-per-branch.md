# 0026 — Reviews per branch

**Status:** accepted, 2026-10-19
**Amends:** ADR 0004 §1 (one review per working tree), §3 (the format)
and §4 (what a save holds); ADR 0015 §9 (rounds kept per working tree)
and §10 (a switched branch's banner); ADR 0020 §1 and §2 (kept per tree,
and pruned when a tree is gone); ADR 0002 §2 (what a watch covers); ADR
0001 §5 (recent folders)
**Affects:** `crates/core/src/saved.rs` (`ReviewKey`, `SavedReview`,
`Seen`, `ReviewStore`), `resume.rs`, `project.rs`, `check.rs`, `repository.rs`
(`Checkout`, `RepoError`), `base.rs` (`default_base`);
`crates/git/src/lib.rs` (`Git::for_branch`), `shows.rs`, `project.rs`, `watch.rs`;
`app/src-tauri/src/lib.rs`, `reviews.rs`, `claims.rs`; `app/src/store.ts`,
`switcher.ts`, `components/Switcher.tsx`, `Welcome.tsx`; the design's
flow 6, "Reviews per branch" (`Agent Review v3.dc.html`)

## Context

A window showed one review per folder and followed whatever was checked
out there. Reviewers run several agents at once, one worktree per
branch, and want to move between the branches' reviews without running
`git checkout`, which would disturb the agent working in that worktree.
They keep several reviews going in one project, and in several projects,
and return to any of them at any time. The developer settled the model
on 2026-10-19, and the design's v3 drew it as flow 6.

## Decision

1. **A review is kept per branch of a project** (`ReviewKey`). A project
   is a repository's common git directory, which all its worktrees share
   (`Checkout::project`). A local branch and its upstream are one branch,
   named without the remote; a remote's branch that is no local branch's
   upstream is named without its remote too, unless that name is taken,
   by a local branch or another remote's branch listed first, when it
   keeps its remote, `origin/fix` (`Project::branches`). A rename follows git: the old name is
   gone and the new one has no review. The developer's call, 2026-10-19.
2. **A review starts with its first comment** and is gone once it holds
   neither comments nor rounds (`SavedReview::is_empty`), so looking at a
   branch leaves nothing behind. It keeps the base the reviewer last chose
   for it, and shows it again (`SavedReview::base`); a base the window
   moves to on its own, following a round or showing what changed, is not
   kept. The developer's calls, 2026-10-19.
3. **A review is shown from wherever its branch is, and never checks it
   out** (`Git::for_branch`). Checked out in a worktree, it is live there,
   uncommitted changes included. Checked out nowhere, it shows the
   branch's commits alone: the uncommitted changes cannot be its base
   (`RepoError::NotCheckedOut`), a new review starts from the default
   branch or else the last commit (`default_base`), and a copy sends no
   round, since no agent is there to take it; Copy is off there, with no
   plain copy either (the developer's call, 2026-10-19). Its watch covers the common
   git directory alone (amends ADR 0002 §2). When the worktree a review is
   live in checks out another branch, that is another review: this one
   falls back to its commits and the banner says so, offering the other
   branch; when a worktree checks its branch out, it is live there,
   unannounced. Agents work one worktree per branch, so a branch being
   worked on is always live (the developer's reading, 2026-10-19).
4. **A review remembers where its branch was** (`SavedReview::seen`): its
   commit when last shown. Shown again after the branch moved on, the
   banner says how many commits came; after a rewrite, the rounds sent on
   commits no longer under the branch are deleted, and the banner names
   them (`resume`). Comments follow their code as on any load. The
   developer's call, 2026-10-19: rewritten rounds are deleted, not kept
   aside.
5. **A detached `HEAD` keeps no review.** Its diff can be read, but no
   comment can be written there, nothing is saved, and a banner says so.
   The developer's call, 2026-10-19, over the design's comments that
   vanish on leaving.
6. **A branch deleted takes its reviews with it** (`check_kept`), noticed when
   the review switcher opens or the app starts, and said once, at the top
   of the switcher; there is no archive. The developer's call, 2026-10-19.
7. **The review switcher** (the design's 6a–6m), from the title bar's
   project and branch or ⌘/Ctrl-K, lists the project's reviews, then
   other projects', each live or committed only, with its open comments,
   its last round and whether its branch moved; typing searches every
   branch of the project too. Only the review on screen is watched; the
   others are checked when the switcher opens. Its last row opens a
   folder, as the title bar's chip did (the developer's call,
   2026-10-19). The welcome screen lists the reviews, most recently
   shown first, where it listed recent folders, which are no longer kept
   (`diff-loop.recent`; amends ADR 0001 §5). (Amended by ADR 0033: the
   welcome screen lists the projects most recently opened, and the
   switcher opens only once a project is shown.)
8. **`reviews.json` is version 4**: `{"version": 4, "projects":
   {"<project>": {"reviews": {"<branch>": SavedReview}, "seen": ms}}}`.
   Versions 1 to 3 kept reviews by working tree, which names no branch:
   they are read as holding none, and written back as version 4 at the
   next save, so their reviews are dropped (the developer's call,
   2026-10-19: no migration). A project whose git directory has been
   missing for 30 days is dropped, as a tree was (ADR 0020 §2).
   (Superseded by ADR 0030 §2 and §7: a file per branch, and
   `reviews.json` no longer read.)
9. **A review is open in one window at a time** (`claims.rs`): a window
   holds a lock on a file named for the review while it shows it, so
   another instance, its own process, is refused it. Picking one that
   another window shows says where it is, by the title it gives its
   window ("drive-web · agent/share-retry"); bringing that window forward, which
   needs a channel between instances and which Wayland refuses anyway, is
   not built (the developer's call, 2026-10-19; open-tasks).

## Consequences

- Reviews saved before this are not carried over.
- A review shown from its commits is read-only to the agent: it can be
  commented on, and the comments wait until a worktree checks the branch
  out.
- Showing a review writes where its branch was, so each one opened is
  saved once, even when nothing else changed.
- A branch kept only on a remote can be reviewed from its commits;
  fetching is the reviewer's, outside the app.
- Each review ever shown leaves an empty lock file in the app-data
  directory's `open/`.
- A folder opened and never commented on is not listed anywhere
  afterwards; it is opened again from the folder.
- A remote's branch named with its remote (`origin/fix`) takes the bare
  name once the local branch holding it is deleted, so its review under
  the old name goes as a deleted branch's does (§1, §6).
