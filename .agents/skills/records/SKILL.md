---
name: records
description: How to keep Diff Loop's records true while changing the code — the open-tasks ledger, the specs and the ADRs. Says when each must change in the same commit, how a spec is shaped, how an entry leaves the ledger, what needs the developer's call, and how to check that nothing still points at what moved. Use whenever a change completes, discovers, or decides work, and whenever editing anything under docs/spec/ or docs/adr/.
---

# Records

The records are how the next session knows what is true. A record that
disagrees with the code, or points at something that is gone, is a defect
of the change that left it so. Keep them in the same commit as the code.

## Which record holds what

| Record | Holds | Changes when |
|---|---|---|
| `docs/spec/diff-loop-open-tasks.md` | Known, understood, undone work, each with its evidence | Work is discovered, done, or decided against |
| `docs/spec/diff-loop-<crate>.md` | A crate's design, Decisions, Pitfalls, dated Progress | A change completes a step, changes a stated rule, or settles a question the spec covers |
| `docs/adr/NNNN-*.md` | One decision that alters a constraint or a persisted format | A new decision (a new ADR), or a factual slip in an existing one |
| `AGENTS.md` | The project's overview, Key Constraints and a one-paragraph summary of each ADR | A Key Constraint changes, or an ADR is added or superseded |

## The shape of a spec

```markdown
# diff-loop-<crate>

One sentence: what it is.

**Status:** active | archived — one line on where it stands.
**Scope:** what it covers, and what it excludes.
**Owner:** <name>
**Last Updated:** YYYY-MM-DD

## Why
## Steps          (what is to be built; each noted when done)
## Decisions      (numbered; a rule and its reason)
## Pitfalls       (what looks right and is not, each learned the hard way)
## Progress (YYYY-MM-DD, <subject>)   (newest first; what landed, and why)
```

An ADR has **Status** (accepted, date), **Supersedes** / **Amends** /
**Affects** where they apply, then **Context**, **Decision** (numbered §),
and **Consequences**.

## In the same commit

- **Discovered work enters the ledger** with its evidence (file and
  function), when the change does not do it. Never leave it only in a
  commit message, a Progress note or a report.
- **Done work leaves the ledger.** Remove the whole item, or the part the
  change completes, and say which parts remain.
- **A touched spec gets its date.** Bump `**Last Updated:**`, and record
  what changed as a dated Progress entry or a Decision. A dated Progress
  entry is history: add a pointer to the newer rule (`since 2026-10-20:
  see Decisions`) rather than rewriting it.
- **A changed fact is changed everywhere it is stated.** Grep the old
  wording across `crates/`, `docs/`, `.agents/` and `AGENTS.md` — specs,
  ADRs, doc comments — and fix each one, or give it a pointer.

## Leaving the ledger

An item leaves by being done or by being decided against. Before it goes:

- **Every part is accounted for.** An item naming two things is closed only
  when both are.
- **Decided against is the developer's call.** Keeping behaviour a finding
  called wrong, narrowing a design rule, or recording something as intended
  needs their answer first, asked in one question with a recommendation.
  Their decision then goes where it belongs, dated and attributed ("The
  developer's call, 2026-10-12"): an ADR, or a Decision in the spec it
  touches.
- **Every citation moves with it.** Grep for the entry's number and its
  subject; a pointer to a closed entry is updated in the same change.

## What each record is not for

- **An ADR is not rewritten.** Fix a factual slip in place — a wrong count,
  a wrong section number — and record a changed decision as a new ADR that
  supersedes the old one.
- **A Progress note is not a summary of intent.** It states what landed,
  in words that stay true: "fixed or settled", not "each fixed with a test",
  when some were settled by a decision.
- **A judge's finding is not a record.** It is fixed, or entered in the
  ledger.

## Checking before the review

1. `git diff --stat` touches `crates/`: does the ledger gain or lose
   anything, and does any spec state what changed?
2. Every path, test name, ADR section, Decision number and ledger entry the
   diff writes resolves: grep it.
3. Every closed item's citations are gone or updated.
4. Every "decided against" or "intended" carries the developer's answer.
