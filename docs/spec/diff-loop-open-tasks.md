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

1. **The commit gate is not built.** The `review` skill's stage 7 —
   refusing an agent's commit unless exactly its tree passed — exists in
   aldwin-agent as `crates/review` (`aldwin-review gate`, the pass record
   keyed by staged tree), `.githooks/pre-commit` and `pre-merge-commit`,
   and the local Claude Code guard (`.claude/hooks/commit-guard.sh` with
   `settings.json`'s `AGENT` env, `core.hooksPath` hook and permission
   denials). That crate also carries aldwin's TUI frame capture, which
   Diff Loop does not need. Closes when a Diff Loop review crate runs
   stages 1–3, records judge verdicts with a command rather than by hand,
   writes the pass record, and the hooks refuse an agent's commit without
   it — with the spec `docs/spec/diff-loop-review.md`.
2. **The loop has no front-end stages.** The front end's framework is not
   chosen (AGENTS.md, "Language & Platform"). Closes when the review skill
   gains its lint, type-check and test stages, a front-end skill states its
   idioms, and a UI judge reads captured windows against the `ux` skill.

## Workspace

3. **No Cargo workspace yet.** The `rust` skill's "Workspace lints" and
   the CI that runs stages 1–3 on every push (aldwin-agent's
   `.github/workflows/ci.yml`) need one. Closes when the core crate and the
   Tauri app are scaffolded with the lints on and CI runs.
