# diff-loop-open-tasks

Work that is known, understood and not done. Each entry says what was seen, where the evidence is, and what would close it.

**Status:** active — a ledger, not a spec. Nothing here blocks anything else.
**Scope:** everything outstanding.
**Owner:** Maximilian
**Last Updated:** 2026-10-12

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
2. **The loop has no front-end stages.** The front end's framework is not
   chosen (AGENTS.md, "Language & Platform"). Closes when the review skill
   gains its lint, type-check and test stages, a front-end skill states its
   idioms, and a UI judge reads captured windows against the `ux` skill.

## Workspace

3. **No Cargo workspace yet.** The `rust` skill's "Workspace lints" and
   CI need one. Closes when the core crate and the Tauri app are
   scaffolded with the lints on, and `.github/workflows/ci.yml` runs the
   review's stages 2–3 (`cargo fmt --all --check`, `cargo clippy
   --workspace --all-targets --locked -- -D warnings`, `cargo test
   --workspace --locked`) on every pull request and push to `main`, on
   each platform a release ships for, with read-only permissions.
