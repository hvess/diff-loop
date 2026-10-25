# Diff Loop

## Project Overview

Diff Loop is a desktop app for reviewing what a coding agent changed:
it keeps one review per branch, shows that branch's diff live from
whichever worktree has it checked out (or from its commits when none
does), takes comments on lines, ranges or with suggested code, and copies
them as Markdown instructions to paste into the agent's session. Do not invent
product behaviour; where a decision is not recorded here, in a spec or in
an ADR, ask the developer.

Shape (quality-gate §2):

| Crate | Path | Role | Spec |
|---|---|---|---|
| `diff-loop-core` | `crates/core` | Domain and its ports, `Repository`, `Project` and `ReviewStore`; no I/O | `docs/spec/diff-loop-core.md` |
| `diff-loop-git` | `crates/git` | `Repository` and `Project` over the `git` command line | `docs/spec/diff-loop-git.md` |
| `diff-loop-app` | `app/src-tauri` | Composition root and Tauri commands | `docs/spec/diff-loop-app.md` |
| `diff-loop-mcp` | `crates/mcp` | MCP server on stdio: an agent reads a branch's review and resolves comments | `docs/spec/diff-loop-mcp.md` |
| `diff-loop-store` | `crates/store` | `ReviewStore` as a file per branch in each project's git directory | `docs/spec/diff-loop-store.md` |
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
  0013, and replaced by the sidebar's width in 0016; the first unused
  since 0026, and keeping recent projects since 0033). The stack gains Lucide, and the fonts become the system's
  on macOS, by 0027.
- **0002 — Watch the checkout instead of polling it.** `Repository::watch`
  on the port; `diff-loop-git` watches with `notify`; the app emits
  `repository-changed`, and polls every 2 s only when a watch cannot start.
- **0003 — Vitest for the front end's tests.** `npm test` in `app/`;
  tests sit beside their module as `<module>.test.ts`.
- **0004 — Reviews kept between runs.** One per working tree (comments;
  a note until 0013; per branch since 0026), through the core's
  `ReviewStore` port, in `reviews.json` in the app-data directory (a file
  per branch in the git directory by 0030); a file it cannot read is never
  overwritten.
- **0005 — Read only what the watch saw touched.** The watch names
  touched paths; `Repository::changes_in` and the core's `update` read
  them again; the app keeps the last load while watching, with what the
  watch touched (and, since ADR 0023, without a watch, with its file
  states).
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
  signed, not notarized. Built on the developer's Mac since 0028.
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
  resolves with R; `reviews.json` is version 2, with rounds (3 since
  ADR 0020). The judging and the format superseded by 0030.
- **0016 — The sidebar folds, merges lone folders, and resizes.** Folders
  fold on a click, a chain of lone folders is one row, the edge drags
  the width, kept under `diff-loop.sidebar`; no guides, a disclosure
  chevron, and 240 px at first, by 0027; long names end in an ellipsis
  rather than scroll sideways, by 0034.
- **0017 — A round on the uncommitted changes follows a commit on top.**
  Comments sent against the uncommitted changes are judged only at the
  commit they were sent on, or compared with it by name; when the agent
  commits on top, the window compares with that commit and says so
  (superseded by 0030).
- **0018 — A change to the index, and a rename's other half.** A change
  to the working tree's index makes the watch report everything, and an
  update reads a new addition or deletion with the opposite kind it
  holds, so neither waits for a full read.
- **0019 — A GTK theme dark by name gives way to its light one.** On
  Linux, when the portal asks for light and the desktop's GTK theme is
  dark by name (`Arc-Dark`), the app draws with its light theme, so
  WebKitGTK, which reads the name too, is light.
- **0020 — Saved reviews are pruned when their tree is long gone, and
  saved in turn.** `reviews.json` version 3 records when each tree was
  last seen (each project since 0026); a save drops a review whose tree
  has been missing for 30 days, and holds a lock beside the file so two
  instances take turns (superseded by 0030).
- **0021 — A commit made while the window was closed is followed.** On
  opening, the newest round's commit stands in for the load before, and a
  short id of seven or more hex digits names a round's commit (superseded
  by 0030).
- **0022 — A follow outlives a later commit.** While the base follows a
  round, a later commit keeps it followed, counted from the round's
  commit, until another base, a switched or rewritten branch, or no open
  comment ends it (superseded by 0030).
- **0023 — A load with no watch reads only what changed.** The port
  tells each changed file's state; with no watch a load keeps them, and
  the next reads again only the paths whose state changed.
- **0024 — CI checks macOS and Windows at a release** (superseded by
  0025).
- **0025 — CI runs only for a release.** By hand (a `v*` tag until 0028), on
  Linux, macOS and Windows; the local gate checks every commit between,
  as Actions bills macOS at 10x and Windows at 2x on a private
  repository.
- **0026 — Reviews per branch.** A review is kept per branch of a
  project (its common git directory), starts with its first comment,
  keeps its base and where its branch was seen, and is shown live from
  the worktree that has the branch checked out, or from its commits,
  never checking anything out; a detached `HEAD` keeps none; a deleted
  branch takes its reviews; a review switcher moves between them;
  `reviews.json` is version 4, and earlier reviews are dropped (a file
  per branch by 0030; the welcome screen lists projects by 0033).
- **0027 — The redesign, drawn for Tauri.** The canvas "Diff Loop macOS
  Redesign" is the app's design, refined for Tauri: opaque layered
  surfaces instead of Liquid Glass; Lucide icons; SF Pro and SF Mono on
  macOS, Geist elsewhere; an inset sidebar, toolbar capsules, a floating
  bottom bar, rails and margin notes; built in phases on main; the
  canvas ported as written, its labels title case.
- **0028 — Releases are built here.** Actions minutes are used up, so
  both workflows run only by hand; a release is built on the developer's
  Mac, its tag pushed and its files attached to a draft release with
  `gh`; which installers it carries is chosen per release.
- **0029 — Watched before the first load.** `show` starts the watch,
  and awaits it, before the first load, so that load is the one the
  watch brings up to date; a load under a watch takes no fingerprint.
- **0030 — The review file, in the project's git directory.** One file
  per branch at `<common git dir>/diff-loop/reviews/<name>.json`, a new
  format with rounds the agent or the reviewer opens, each comment a
  thread the agent answers; each round's snapshot is a commit of the
  working tree kept by `refs/diff-loop/<name>/<number>`; app and MCP
  server save in turn on a lock beside the file; nothing is guessed, and
  `reviews.json` is no longer read. Its snapshots, threads and handed
  rounds were withdrawn by 0032. Takes effect as `diff-loop-mcp`'s
  steps land.
- **0031 — The review file is built in steps, and the projects with one
  are listed.** The file grows to 0030's shape step by step at version 1;
  `projects.json` in the app-data directory lists the projects that hold
  a review; the store is the `diff-loop-store` crate; the watch ignores
  Diff Loop's own folder; a listing leaves out a review it cannot read.
- **0032 — The agent resolves comments in the review file.** Through
  `diff-loop-mcp` or by editing the file the copied instructions name,
  with a note; the comment stays, shown as resolved by the agent until
  the reviewer accepts it (R) or edits it to reopen it; a save keeps a
  mark the window has not seen, and the window watches the file. 0030's
  snapshots, threads and handed rounds are withdrawn.
- **0033 — The welcome screen lists projects.** The 8 projects most
  recently opened, by name and folder, each opening its main checkout,
  kept under `diff-loop.recent`; no review is listed there, and the
  switcher opens only once a project is shown.
- **0034 — Long names in the sidebar end in an ellipsis.** The tree
  never scrolls sideways; a name too long for its row is cut at its end,
  its status letter kept and its full path the row's tooltip.

## Key Constraints (non-negotiable)

- **The core knows no adapter.** The core crate depends on no Tauri crate
  and no other workspace crate; the Tauri app depends on it, never the
  reverse (quality-gate §2).
- **A decision against fixing something is the developer's call**, asked
  in one question with a recommendation, and recorded where it belongs
  (records skill).
