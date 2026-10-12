# Diff Loop

## Project Overview

Diff Loop is a desktop app with a Rust core and a Tauri front end. The
project is at its start: there is no Cargo workspace and no front end yet.
Do not invent product behaviour; where a decision is not recorded here, in
a spec or in an ADR, ask the developer.

Shape: the Rust core is a library crate that knows nothing of Tauri; the
Tauri app is an adapter around it (quality-gate §2). As crates are added
under `crates/`, each gets a spec in `docs/spec/`.

## Language & Platform

The core is Rust. Idioms are Rust idioms — do not translate patterns from
other languages. The references are the Rust Book, std docs, the Tauri 2
docs and each crate's own documentation. The front end's framework is not
chosen yet; no front-end skill exists until it is.

## Spec Workflow

Specs are in `docs/spec/` — read the relevant one before implementing.
When a spec step is completed, note it; when all steps are done, move the
spec to `docs/spec/archive/`.

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
before reopening a decision they cover. None yet.

## Key Constraints (non-negotiable)

- **The core knows no adapter.** The core crate depends on no Tauri crate
  and no other workspace crate; the Tauri app depends on it, never the
  reverse (quality-gate §2).
- **A decision against fixing something is the developer's call**, asked
  in one question with a recommendation, and recorded where it belongs
  (records skill).
