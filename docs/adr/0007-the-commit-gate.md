# 0007 — The commit gate

**Status:** accepted, 2026-10-13
**Amends:** ADR 0001 §4: the gate, a dev tool, runs `git` itself rather
than through `crates/git` (`docs/spec/diff-loop-review.md` Decision 10)
**Affects:** open-tasks 1 (closed here); `.agents/skills/review/SKILL.md`;
`docs/spec/diff-loop-review.md`

## Context

The review loop was a rule with nothing enforcing it: an agent could commit
without running it, and a judge's verdict was whatever the author saved.

## Decision

1. **An agent's commit needs a pass record** for exactly the tree it
   commits: `.githooks/pre-commit` refuses one without, when `AGENT` or
   `CLAUDECODE` is set. A person's commit is not gated.
2. **Only `diff-loop-review pass` writes a record**, after the stages ran
   on that tree and every judge its paths need gave a verdict with no
   findings, piped in by the judge through `diff-loop-review verdict`.
3. **A new persisted format:** a pass record is a file named for the tree
   under the git directory's `diff-loop-review/passed/`, holding the run
   directory's path. It is local and never committed.
4. **Skipping the gate is deliberate, not impossible**: the local guard
   refuses the usual ways round it, but reads words, not a shell.

## Consequences

- An agent's commit costs a full run of the stages and the judges; a
  change after the pass needs a new run.
- Each checkout installs the gate once (`diff-loop-review install-guard`);
  until then its hooks do not run.
