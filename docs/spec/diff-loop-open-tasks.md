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
2. **The loop has no front-end stages.** The stack is chosen (ADR 0001)
   and `npm run typecheck` / `npm run build` in `app/` pass, but the review
   skill does not run them. Closes when the review skill gains the front
   end's lint, type-check and test stages, a front-end skill states its
   idioms, and a UI judge reads captured windows against the `ux` skill.

## Workspace

3. **No CI.** The workspace and its lints exist (`Cargo.toml`). Closes
   when `.github/workflows/ci.yml` runs the
   review's stages 2–3 (`cargo fmt --all --check`, `cargo clippy
   --workspace --all-targets --locked -- -D warnings`, `cargo test
   --workspace --locked`) on every pull request and push to `main`, on
   each platform a release ships for, with read-only permissions.

## App

4. **Review comments are lost when the app quits.** They live only in
   the front end's store (`app/src/store.ts`, `comments`). Closes with a
   persisted format for a review per checkout and base, decided in an
   ADR.
5. **Unchanged lines cannot be expanded.** A hunk header says how many
   lines are hidden (`app/src/rows.ts`, `hiddenBefore`); the design's
   "Show 12 unchanged lines" needs a core call returning a line range of
   either side.
6. **`git` must be on the app's `PATH`.** `crates/git/src/command.rs`
   runs `git` by name; an app launched from the macOS Finder gets a
   minimal `PATH` and may not find a Homebrew git. Closes when the
   adapter resolves git as a login shell would, or the developer decides
   against it.
7. **A detected change rebuilds the whole diff in Rust**
   (`diff_loop_core::load`); only new or changed files cross IPC
   (`KnownFile`, `ReviewFile`). And when a watch cannot start (ADR 0002 §4,
   e.g. the inotify limit on a very large tree) the app falls back to
   polling every 2 s (`app/src/App.tsx`, `POLL_MS`). Closes when diffs are
   rebuilt per changed path, or the developer decides the cost is fine.
8. **Design details not built:** the sidebar's "tested by" / "imported
   by" captions, the base picker's ahead/behind and file counts ("2
   behind", "1 file"), and the app icon (`app/src-tauri/icons/` are
   placeholders). Each needs the developer's word on whether it is still
   wanted.
