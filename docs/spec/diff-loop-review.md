# diff-loop-review

The review loop's commit gate: a dev-only command that runs the loop's stages, records the judges' verdicts, and lets an agent commit only a tree that passed.

**Status:** active — first version landed.
**Scope:** `crates/review`, `.githooks/`, and the local Claude Code guard it writes. Excludes the loop's rules themselves (`.agents/skills/review/SKILL.md`).
**Owner:** Maximilian
**Last Updated:** 2026-10-16

## Why

The `review` skill's stage 7 was a rule with nothing enforcing it: an
agent could commit without running the loop (open-tasks 1). The gate makes
skipping it deliberate, not impossible.

## Steps

1. `begin`: check the working tree holds exactly the staged change, run
   stages 1–3, write the run directory with the staged diff and the judges
   it needs — done 2026-10-13.
2. `verdict`: take a judge's JSON verdict on stdin and keep it in the run — done 2026-10-13.
3. `pass`: write a pass record for the staged tree when stages and every
   required judge passed on exactly that tree — done 2026-10-13.
4. `check`, and `.githooks/pre-commit` / `pre-merge-commit`: refuse an
   agent's commit whose tree has no pass record — done 2026-10-13.
5. `guard` and `install-guard`: the local Claude Code guard — done 2026-10-13.

## Decisions

1. **Dev-only.** `diff-loop-review` is a binary in the workspace that no
   other crate depends on, so no release build of the app contains it.
2. **A run is a directory** under `target/review/<timestamp>/`:
   `change.diff` (the staged diff), `run.json` (the staged tree and the
   judges required), and one `<judge>.json` per verdict. `run.json` is
   written only once the stages passed. `target/` is ignored, so runs are
   local.
3. **The tree is the index's** (`git write-tree`, which honours
   `GIT_INDEX_FILE`): the tree git is about to commit, not the working
   tree. `begin` refuses unstaged or untracked changes, because the
   judges read the working tree.
4. **Stages 1–3 always run, all of them**: the toolchain matches
   `rust-toolchain.toml`; `cargo fmt --all --check`, `cargo clippy
   --workspace --all-targets --locked -- -D warnings`, `cargo test
   --workspace --locked`; and in `app/`, `npm run lint`, `npm run
   typecheck`, `npm test`, `npm run build`. Choosing stages by path would
   be a second copy of what each stage covers.
5. **Judges are chosen by path**, as the review skill's "Which judges
   run" says: `code-1` and `code-2` for `crates/`, `app/src-tauri/`,
   `app/src/`, `Cargo.toml`, `Cargo.lock`, `app/package.json` and
   `.githooks/`; `rust` for any `.rs`; `ui` for a `.tsx` or `.css` under
   `app/src/`.
6. **A verdict goes through `verdict`**, piped by the judge itself: the
   author never writes or transcribes one. A verdict that is not the
   review skill's JSON shape is refused; one with findings is kept, and
   `pass` then refuses the run.
7. **A pass record** is a file named for the tree in the git directory
   (`git rev-parse --git-path diff-loop-review/passed/<tree>`), holding the
   run directory. Only `pass` writes it, and only when `run.json`'s tree
   is still the staged tree and every judge the staged paths need, worked
   out again rather than read from `run.json`, gave a verdict with no
   findings.
8. **The hooks apply to agents only**: `.githooks/pre-commit` runs
   `check` when `AGENT` or Claude Code's `CLAUDECODE` is set; otherwise it
   lets the commit through. `pre-merge-commit` calls it.
9. **Installing is per checkout, and nothing is committed** (AGENTS.md:
   the repository ships no agent configuration): `install-guard` sets
   `core.hooksPath` to `.githooks` in the checkout's own git config, so the
   hooks run for every agent, keeps `.claude/` out of git through
   `info/exclude` when nothing ignores it (`begin` refuses untracked
   files), and writes `.claude/settings.json`, which
   sets `AGENT`, denies edits to `.githooks/`, the pass records and the
   run directories (a linked worktree's records, which lie in the main
   checkout's `.git/worktrees/<name>/`, outside its project, also by
   their absolute path, Claude Code's `//` form, on Unix, where the
   guard's own hook runs too; since 2026-10-16), and runs `guard`
   before every Bash command (the built binary, else through cargo).
   `guard` refuses `--no-verify`, `git commit -n`, any setting of
   `core.hooksPath` or a git alias, git config set through `GIT_CONFIG*`
   in a command's environment, and the commands that commit without the
   hook: `commit-tree`, `cherry-pick`, `revert`, `rebase`, `am`. It
   reads words, not a shell, so it can be fooled; it makes skipping the
   gate deliberate. Input that is not a Bash call passes: refusing it
   would block every command should Claude Code's format change.

10. **The gate runs git itself** (`git.rs`), not through
    `diff-loop-git`: a dev tool depends on no part of the app, and its
    questions (the index's tree, the staged paths) are not the app's. The
    developer's call, 2026-10-13.

## Pitfalls

- A linked worktree's pass records sit in the main checkout's git
  directory (`.git/worktrees/<name>/`), outside the worktree's project:
  a deny rule relative to the project does not reach them, so
  `install-guard` adds one by absolute path (Decision 9). A worktree
  installed before 2026-10-16 is guarded once `install-guard` runs in it
  again.

- A hook's `git write-tree` must see the index git is committing, so
  nothing in `check` may clear `GIT_INDEX_FILE`.

## Progress (2026-10-16, a linked worktree's records)

`install-guard` denies a linked worktree's pass records by their
absolute path (Decision 9), closing open-tasks 11.

## Progress (2026-10-13, first version)

The crate, hooks and guard landed (ADR 0007, closing open-tasks 1).
