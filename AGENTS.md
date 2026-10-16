# Diff Loop

## Project Overview

Diff Loop is a desktop app for reviewing what a coding agent changed:
it shows the diff of whatever branch or worktree is checked out, takes
comments on lines, ranges or with suggested code, and copies them as
Markdown instructions to paste into the agent's session. Do not invent
product behaviour; where a decision is not recorded here, in a spec or in
an ADR, ask the developer.

Shape (quality-gate §2):

| Crate | Path | Role | Spec |
|---|---|---|---|
| `diff-loop-core` | `crates/core` | Domain and its ports, `Repository` and `ReviewStore`; no I/O | `docs/spec/diff-loop-core.md` |
| `diff-loop-git` | `crates/git` | `Repository` over the `git` command line | `docs/spec/diff-loop-git.md` |
| `diff-loop-app` | `app/src-tauri` | Composition root and Tauri commands | `docs/spec/diff-loop-app.md` |
| `diff-loop-review` | `crates/review` | The review loop's commit gate; dev-only | `docs/spec/diff-loop-review.md` |

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
`cargo test` — never edit them by hand. Its idioms are the `frontend`
skill's.

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
gate (`docs/spec/diff-loop-review.md`) refuses an agent's commit whose
tree did not pass; install its local guard once per checkout with
`cargo run -q -p diff-loop-review -- install-guard`.

## Skills

`.agents/skills/*/SKILL.md` are plain Markdown, whatever agent you are:
read the one whose description matches the task before starting it —
`rust` and `quality-gate` for any Rust change, `frontend` for anything
under `app/src` (with `mastering-typescript` as the general TypeScript
reference; where they differ, `frontend` and the ADRs win), `big-o` and
`data-structures` for any loop, collection, search, sort, cache or
recursion, `comments` for any comment, `ux` for anything the user sees,
`records` for the specs, ADRs and ledger, `review` before committing.

This repository ships no agent-specific configuration; its git hooks
(`.githooks/`) gate an agent that sets `AGENT` (or Claude Code's
`CLAUDECODE`), and run only once a checkout installs them. Claude Code reads
neither this file nor `.agents/skills/`: give it a local `.claude/CLAUDE.md`
holding `@../AGENTS.md`, and link `.claude/skills` to `../.agents/skills`.

## Decision records

`docs/adr/` holds numbered architecture decision records (`NNNN-title.md`)
for changes that alter a stated constraint or a persisted format. Read them
before reopening a decision they cover.

- **0001 — Front-end stack, and git through its command line.** Tauri 2
  with React 19, TypeScript, Vite, Tailwind 4, Radix, Zustand, TanStack
  Virtual and Shiki; Rust types reach TypeScript through `ts-rs`; git is
  read by running `git` with optional locks off; two `localStorage` keys
  (recent folders, instruction preferences; the second unused since
  0013, and replaced by the sidebar's width in 0016).
- **0002 — Watch the checkout instead of polling it.** `Repository::watch`
  on the port; `diff-loop-git` watches with `notify`; the app emits
  `repository-changed`, and polls every 2 s only when a watch cannot start.
- **0003 — Vitest for the front end's tests.** `npm test` in `app/`;
  tests sit beside their module as `<module>.test.ts`.
- **0004 — Reviews kept between runs.** One per working tree (comments;
  a note until 0013), through the core's `ReviewStore` port, in
  `reviews.json` in the app-data directory; a file it cannot read is
  never overwritten.
- **0005 — Read only what the watch saw touched.** The watch names
  touched paths; `Repository::changes_in` and the core's `update` read
  them again; the app keeps the last load only while watching.
- **0006 — The front end's review stages.** ESLint, `tsc`, Vitest and
  the build in the review loop and CI; a `frontend` skill; a UI judge
  over captured windows.
- **0007 — The commit gate.** An agent's commit needs a pass record for
  its tree, written only by `diff-loop-review pass` after clean stages
  and verdicts. The hooks are committed; installing them, the guard and
  the pass records are per checkout and never committed.
- **0008 — Type-aware lint, and exact optional properties.** The lint
  stage runs typescript-eslint's `recommendedTypeChecked`; the store's
  actions are function-typed properties; `exactOptionalPropertyTypes` is
  on.
- **0009 — Releases for Linux and Apple Silicon.** A `v<version>` tag
  builds an AppImage, a `.deb` and an Apple Silicon `.dmg` into a draft
  GitHub Release in this private repository; macOS builds are ad-hoc
  signed, not notarized.
- **0010 — Native behaviour of the window.** Hidden until first paint,
  its state kept (`tauri-plugin-window-state`); a release profile with
  LTO; on Linux, shared-memory buffers under NVIDIA and the portal's
  colour scheme (`gio`); native menus (a menu bar on macOS only, context
  menus); indicators after 200 ms; no beep on macOS.
- **0011 — Highlighting off the UI thread, and the React Compiler.**
  Shiki tokenizes in a Web Worker from its fine-grained modules, cached
  per file version; the React Compiler memoizes at build time; the
  selected file renders deferred.
- **0012 — The review arrives in batches.** `load_review` sends its files
  through a `Channel` in batches of about 2000 diff lines, then the rest;
  `api.loadReview` joins them, and the core is unchanged.
- **0013 — The v2 design.** The sidebar is a tree built in the front
  end, and the core's roles are gone; instructions are always Markdown
  with code quoted, edited in the preview for that copy; no general note
  is kept, and an earlier `reviews.json`'s note is ignored.
- **0014 — A full read on request.** `load_review` takes `full`, which
  reads everything even while a watch runs; ⌘/Ctrl-R asks for one, so
  changes the watch cannot see show on request.
- **0015 — Rounds, and comments resolved rather than removed.** A copy
  ends a round and sends every open comment with its code and context;
  a load judges each sent comment against what it was sent on
  (untouched, nearby changed, changed, removed, applied), marks a draft
  whose code went lost rather than removing it, and the reviewer
  resolves with R; `reviews.json` is version 2, with rounds.
- **0016 — The sidebar folds, merges lone folders, and resizes.** Folders
  fold on a click, a chain of lone folders is one row, the edge drags
  the width, kept under `diff-loop.sidebar`.
- **0017 — A round on the uncommitted changes follows a commit on top.**
  Comments sent against the uncommitted changes are judged only at the
  commit they were sent on, or compared with it by name; when the agent
  commits on top, the window compares with that commit and says so.

## Key Constraints (non-negotiable)

- **The core knows no adapter.** The core crate depends on no Tauri crate
  and no other workspace crate; the Tauri app depends on it, never the
  reverse (quality-gate §2).
- **A decision against fixing something is the developer's call**, asked
  in one question with a recommendation, and recorded where it belongs
  (records skill).
