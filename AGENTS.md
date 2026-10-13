# Diff Loop

## Project Overview

Diff Loop is a desktop app for reviewing what a coding agent changed:
it shows the diff of whatever branch or worktree is checked out, takes
comments on lines, ranges or with suggested code, and copies them as
plain-text instructions to paste into the agent's session. Do not invent
product behaviour; where a decision is not recorded here, in a spec or in
an ADR, ask the developer.

Shape (quality-gate §2):

| Crate | Path | Role | Spec |
|---|---|---|---|
| `diff-loop-core` | `crates/core` | Domain and the `Repository` port; no I/O | `docs/spec/diff-loop-core.md` |
| `diff-loop-git` | `crates/git` | `Repository` over the `git` command line | `docs/spec/diff-loop-git.md` |
| `diff-loop-app` | `app/src-tauri` | Composition root and Tauri commands | `docs/spec/diff-loop-app.md` |

The front end is `app/src` (React). Each new crate gets a spec in
`docs/spec/`.

Run it: `cd app && npm install && npm run tauri dev`. A built binary opens
a folder given as its first argument (`diff-loop-app <path>`).

## Language & Platform

The core is Rust. Idioms are Rust idioms — do not translate patterns from
other languages. The references are the Rust Book, std docs, the Tauri 2
docs and each crate's own documentation. The front end is React 19,
TypeScript and Vite (ADR 0001); its types for anything crossing the
Tauri boundary are generated from Rust into `app/src/bindings/` by
`cargo test` — never edit them by hand. No front-end skill exists yet
(open-tasks 2).

## Spec Workflow

Specs are in `docs/spec/` — read the relevant one before implementing.
When a spec step is completed, note it; when all steps are done, move the
spec to `docs/spec/archive/`. A crate's spec is the exception: it stays
active while the crate exists and gains steps as work lands (the
developer's call, 2026-10-13).

`docs/spec/diff-loop-open-tasks.md` is a ledger rather than a spec: known,
understood, undone work, each entry citing its evidence.

**The review loop.** `.agents/skills/review/SKILL.md` is the feedback loop
every agent commit runs: deterministic stages, then blind subagent judges,
iterated until nothing is found. Run it before every commit. The commit
gate that makes it compulsory is not built yet (open-tasks 1): until it is,
the loop is the rule, and skipping it is a defect of the commit.

## Skills

`.agents/skills/*/SKILL.md` are plain Markdown, whatever agent you are:
read the one whose description matches the task before starting it —
`rust` and `quality-gate` for any Rust change, `big-o` and
`data-structures` for any loop, collection, search, sort, cache or
recursion, `comments` for any comment, `ux` for anything the user sees,
`records` for the specs, ADRs and ledger, `review` before committing.

This repository ships no agent-specific configuration. Claude Code reads
neither this file nor `.agents/skills/`: give it a local `.claude/CLAUDE.md`
holding `@../AGENTS.md`, and link `.claude/skills` to `../.agents/skills`.

## Decision records

`docs/adr/` holds numbered architecture decision records (`NNNN-title.md`)
for changes that alter a stated constraint or a persisted format. Read them
before reopening a decision they cover.

- **0001 — Front-end stack, and git through its command line.** Tauri 2
  with React 19, TypeScript, Vite, Tailwind 4, Radix, Zustand, TanStack
  Virtual and Shiki; Rust types reach TypeScript through `ts-rs`; git is
  read by running `git` with optional locks off; the only persisted state
  is two `localStorage` keys (recent folders, instruction preferences).
- **0002 — Watch the checkout instead of polling it.** `Repository::watch`
  on the port; `diff-loop-git` watches with `notify`; the app emits
  `repository-changed`, and polls every 2 s only when a watch cannot start.

## Key Constraints (non-negotiable)

- **The core knows no adapter.** The core crate depends on no Tauri crate
  and no other workspace crate; the Tauri app depends on it, never the
  reverse (quality-gate §2).
- **A decision against fixing something is the developer's call**, asked
  in one question with a recommendation, and recorded where it belongs
  (records skill).
