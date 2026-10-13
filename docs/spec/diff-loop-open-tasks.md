# diff-loop-open-tasks

Work that is known, understood and not done. Each entry says what was seen, where the evidence is, and what would close it.

**Status:** active — a ledger, not a spec. Nothing here blocks anything else.
**Scope:** everything outstanding.
**Owner:** Maximilian
**Last Updated:** 2026-10-13

An entry leaves this file by being done, or by being decided against — in
which case the decision goes where it belongs (an ADR, or the spec it
contradicts) and the entry says so before it goes.

## Review loop

1. **The commit gate is not built.** The `review` skill's stage 7 is a
   rule with nothing enforcing it: an agent can commit without running the
   loop. Closes when all of these exist, specified in
   `docs/spec/diff-loop-review.md`:
   - a dev-only review crate, never in a release build, that runs stages
     1–3, decides which judges the staged diff needs, and takes each
     judge's JSON verdict through a command — never transcribed by the
     author — rejecting any verdict with findings;
   - a pass record keyed by the staged tree's hash, written only when
     stages 1–3 and every required judge passed on exactly that tree;
   - `.githooks/pre-commit` (and `pre-merge-commit`, which calls it) that,
     when `AGENT` or Claude Code's `CLAUDECODE` is set, refuses a commit
     whose tree has no pass record, reading the index git is about to
     commit, `GIT_INDEX_FILE` included;
   - a local Claude Code guard (`.claude/settings.json` setting `AGENT`
     and `core.hooksPath`, denying edits to the hooks and the record, and
     a `PreToolUse` hook refusing `--no-verify`, `-n`, a changed
     `core.hooksPath`, git aliases, and the git commands that commit
     without the hook: `commit-tree`, `cherry-pick`, `revert`, `rebase`,
     `am`). The guard makes skipping the gate deliberate, not impossible.
## App

7. **Without a watch, every check reads the whole diff.** When a watch
   cannot start (ADR 0002 §4, e.g. the inotify limit on a very large
   tree), focus and the 2 s poll take a full fingerprint, and a change
   triggers a full load (`app/src/App.tsx`, `POLL_MS`; ADR 0005 §4). Closes when a
   checkout too large to watch can be checked by less, or the developer
   decides the cost is fine.
8. **The app icon is a placeholder** (`app/src-tauri/icons/`). The
   developer wants one, designed in claude.ai/design and taken from
   there, 2026-10-13.
9. **Saved reviews are never pruned, nor shared safely between
   instances.** `reviews.json` (ADR 0004) keeps an entry for every
   working tree ever reviewed, moved or deleted ones included, and each
   save rewrites it whole (`JsonReviews::save`,
   `app/src-tauri/src/reviews.rs`). Its lock is per process, so two
   running instances can overwrite each other's saves. Closes when
   entries for working trees that no longer exist are dropped, and
   saving is safe across processes, or the developer decides against
   either.
10. **Two changes show only at the next full read** (ADR 0005,
    Consequences): a change to the index alone (`git rm --cached`) moves
    no snapshot and touches no working-tree path, and a rename into a
    path the watch did not touch shows as an addition and a deletion
    (`update`, `crates/core/src/update.rs`). Closes when a load since the
    last notices both, or the developer decides the wait is fine.
