---
name: review
description: The feedback loop every agent commit to Diff Loop runs. Deterministic stages (toolchain, lint with the rust skill's checkable rules, tests), then blind subagent judges for the code (quality-gate, Key Constraints, ADRs) and the Rust (the rust skill), iterated until nothing is found. Use before every commit, not while the change is being written.
---

# Review

A change needs two questions answered before it lands: did it break
anything, and does it hold to what this project has decided — its
architecture and its Rust. The first is mechanical and the second mostly is
not, and the loop keeps them apart: deterministic stages a command runs,
then judges — subagents — because no script can read code against a design
principle.

| stage | what | who |
| --- | --- | --- |
| 1 toolchain | `rustc --version` matches `rust-toolchain.toml` | you |
| 2 lint | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings` with the workspace lints — the checkable rules of the `rust`, `big-o` and `data-structures` skills; in `app/`, `npm run lint` and `npm run typecheck` (ADR 0006) | you |
| 3 test | `cargo test --workspace`; in `app/`, `npm test` and `npm run build` | you |
| 4 code judge | the diff against `quality-gate`, the Key Constraints, the ADRs, the crate's spec, and for `app/src` the `frontend` skill | two subagents, one verdict |
| 5 Rust judge | the diff against the `rust` skill's rules no lint checks | a subagent |
| 5 UI judge | captured windows against the `ux` skill; runs beside the Rust judge | a subagent |
| 6 iterate | any failure: fix, and run again from stage 1 | you |
| 7 gate | the commit is refused unless exactly its tree passed | **not built yet** (open-tasks 1) |

**Until the gate exists, nothing stops a commit that skipped this loop —
so skipping it is the author's defect, not a shortcut.** Once it exists:
no `--no-verify`, no `-n`, no changing where hooks are read from, and none
of the git commands that write commits without the hook. If the gate
refuses, run the loop; never find another way to commit.

## Before you start: the author's loop

**The judges confirm; they do not search.** A judge finding is a defect the
author could have found, and each one costs a full round — so the loop is
promoted to the judges only when the author's own checks come back clean.
When the author skips this, a small change can use all five iterations
with every deterministic stage passing, each round's findings being things
the skills already state and the author did not check. Until clean, repeat:

1. **Stages 1–3**, without staging. All must pass. No judge runs on a tree
   that fails one: a judge reading code that does not build reports a
   consequence as a cause.
2. **The author's pass** — the checks the stages cannot make, each stated
   in a skill the judges read:
   - **Walk quality-gate** against `git diff`, every section; §2, §3 and §4
     above all: the core naming a Tauri type, a flag or a magic value
     standing in for a variant, one rule decided in two places. §5's cost
     check too: for every loop, collection and recursion the diff adds,
     name n and how often it runs (big-o skill, "Checking a change").
   - **Grep every identifier and phrase the diff removes or renames**
     across `crates/`, `docs/`, `.agents/` and `AGENTS.md`. Each hit is
     fixed or given a pointer (records skill).
   - **Test each changed behaviour at the layer that produces it**, not
     only where it is shown, and the edge values of any mapping it adds.
   - **The records skill's "Checking before the review"**.

Only then stage and run the judges.

**Stage exactly what the commit is, and nothing else.** The judges read the
working tree for context, so it must hold exactly the staged change —
untracked files included. Put anything else aside first
(`git stash push --keep-index --include-untracked` is one way).

**Nothing the author writes is an input to its own review.** No goal, no
focus, no summary of the change: a rubric written by the agent being judged
is one it can always pass. Which judges run is read off the staged diff;
the diff is the only statement the author makes.

## Which judges run

- **Code judge** — any path under `crates/`, `app/src-tauri/` or
  `app/src/`, `Cargo.toml` / `Cargo.lock`, `app/package.json`, or the
  gate's own hooks once they exist.
- **Rust judge** — any `.rs` file.
- **UI judge** — any `.tsx` or `.css` file under `app/src/`.

A change with no judge to run — docs only — passes when stages 1–3 pass.

**Capturing windows for the UI judge.** Run the app on a checkout that
shows what changed (`cd app && npm run tauri dev -- -- <path>`), bring
each view the diff alters into the state it changes — light and dark —
and capture the window into `<run>/windows/` as PNG, one file per state,
named for it (`sidebar-captions-dark.png`). On Linux `grim -g` with the
window's geometry, on macOS `screencapture -l <window id>`. Capture
before judging; the judge cannot run the app.

Write the staged diff for the judges, in a run directory per review:

```sh
run=target/review/$(date +%Y%m%d-%H%M%S) && mkdir -p "$run" && git diff --cached > "$run/change.diff"
```

## The judges

Spawn **fresh subagents for every judge, per iteration, all in parallel** —
two for the code judge, one for the Rust judge. The code judge's two
readers are not there to vote: each fresh reader of a large diff finds one
or two different things, and their findings are merged. Fresh every
iteration: one that remembers its last verdict anchors on it, and one that
knows what you changed is biased toward seeing the change work.

Hand each one its prompt below with the run's `change.diff` path filled in.
Never your own account of the change.

What every prompt does, each for a measured reason:

- **It ranks its sources.** The sources disagree in places, and a judge with
  no precedence rule invents one.
- **It refuses to let low confidence become a finding.** Anything unsure
  goes under "questions", which does not fail the stage.
- **It is blind.** The judge sees the change, not the conversation that made
  it and not an earlier verdict.
- **It asks for findings, not a number.** A verdict passes with no findings
  and fails with any; severity orders the fixing.
- **Its whole output is one JSON block**, saved verbatim to the run
  directory (`code-1.json`, `code-2.json`, `rust.json`) — so the judge's own
  words are the record, not the author's transcription of them. Never edit
  or summarise a verdict before saving it.

The shape both return:

    ```json
    {
      "iteration": 1,
      "findings": [
        { "severity": "major",
          "source":   "quality-gate §2 — the core knows no adapters",
          "expected": "the core crate names no tauri crate",
          "found":    "core::session imports tauri::AppHandle",
          "at":       "crates/core/src/session.rs:12" }
      ],
      "contradictions": ["one string per place a source disagrees with itself, both halves cited"],
      "questions":      ["one string per thing you could not resolve"],
      "matches":        ["one string per thing you checked and found holds"]
    }
    ```

### The code judge

> You are reviewing a change to Diff Loop, a desktop app with a Rust core
> and a Tauri front end, against the decisions the project has made about
> its code. You are blind to the conversation that produced the change by
> design: you see the change, not its author's reasons.
>
> **The change:** `<run>/change.diff` — the staged diff. The working tree
> holds exactly that change applied, so you may read any file for the
> context a hunk needs. **Judge only what the diff changes.** Code it does
> not touch is not this change's business, and reporting it is the most
> common way this stage goes wrong.
>
> **What you judge against, and which source wins.** When two disagree, the
> one higher in the list wins:
>
> 1. `AGENTS.md`, the section **Key Constraints (non-negotiable)**.
> 2. `docs/adr/*.md` — numbered decisions. A change that follows a later
>    ADR where an earlier one disagrees is conformant.
> 3. `.agents/skills/quality-gate/SKILL.md` — every section, and the
>    skills it names: `.agents/skills/comments/SKILL.md` (§6), and
>    `.agents/skills/big-o/SKILL.md` and
>    `.agents/skills/data-structures/SKILL.md` (§5). A cost finding names
>    n, why it is unbounded, and how often the code runs; a small, bounded
>    n is not a finding (big-o, "When it matters here").
> 4. The spec for each crate the diff touches: `docs/spec/diff-loop-<crate>.md`,
>    or `docs/spec/archive/` for an archived one, and for any path under
>    `app/src/`, `.agents/skills/frontend/SKILL.md`, with
>    `docs/spec/diff-loop-app.md`. A spec step the change completes should
>    be noted in it.
>
> Read nothing else, and do not judge Rust idiom — a separate judge owns the
> `rust` skill.
>
> - **major** — the change breaks source 1, 2 or 3.
> - **minor** — the change breaks source 4, or leaves a spec or the
>   open-tasks ledger (`docs/spec/diff-loop-open-tasks.md`) stale where it
>   completed or discovered work.
>
> **Your entire output is one fenced `json` block and nothing else**, in the
> shape above. At most six findings, each one you can demonstrate with a
> `file:line` and the sentence of the source it breaks. A finding whose
> source you cannot name is not a finding. Anything you are unsure of is a
> question. Do not pad.

### The Rust judge

> You are reviewing a change to a Rust workspace against one document: the
> project's `rust` skill. You are blind to the conversation that produced
> the change by design.
>
> **The change:** `<run>/change.diff` — the staged diff. You may read any
> file for context. **Judge only the lines the diff adds or changes.**
>
> **What you judge against:** `.agents/skills/rust/SKILL.md`, and nothing
> else. Follow the rule its Good and Avoid examples illustrate, not their
> exact text.
>
> Some of its rules are already enforced by `cargo fmt`, `cargo clippy -D
> warnings` and the workspace lints: formatting, naming, `?` over `match`
> where clippy's `question_mark` fires, docs on public items, `# Errors` and
> `# Panics` sections, `Debug` on public types. **Do not report those** —
> clippy has passed. Judge what no lint checks, among them:
>
> - iterator chains and combinators over manual loops with `push`;
> - `?` through `From` / `#[from]` rather than `map_err` to the same
>   conversion, and `map_err` only for context `From` cannot express;
> - `thiserror` for error types;
> - the Tauri rules: a command converts and delegates, its error is a
>   typed serialisable enum, state is managed, nothing blocks the runtime;
> - imports grouped per crate with braces, and imports rather than
>   qualified paths in signatures;
> - no `# Examples` sections in doc comments;
> - "Avoid Overengineering": only what the task required, no extra layers;
> - "A bug fix lands with the test that would have caught it".
>
> - **major** — a rule the skill states as a requirement, broken in code the
>   change adds.
> - **minor** — a preference it states ("prefer", "where appropriate")
>   passed over without a reason written next to it.
>
> **Your entire output is one fenced `json` block and nothing else**, in the
> shape above: `source` is the skill's section heading, `at` is `file:line`.
> At most six findings. Anything unsure is a question.

### The UI judge

> You are reviewing how a change to Diff Loop's window looks and reads,
> against one document. You are blind to the conversation that produced
> the change by design.
>
> **The change:** `<run>/change.diff`, and the windows captured after it
> in `<run>/windows/`, one PNG per state, named for it. Read every PNG.
> **Judge only what the diff changes**, as the windows show it.
>
> **What you judge against:** `.agents/skills/ux/SKILL.md` — its gate,
> line by line — and the HIG pages it names for what you see. Read
> nothing else. Do not judge code.
>
> - **major** — a line of the `ux` gate fails in a captured window.
> - **minor** — something the HIG page for that element says, passed over.
>
> **Your entire output is one fenced `json` block and nothing else**, in
> the shape above: `source` is the gate line or HIG page, `at` is the PNG
> and where in it. At most six findings. Anything you cannot see in a
> window is a question.

## Iterate

Any failure — a stage, or a judge's finding — means: fix it, go back
through the author's loop until it is clean, stage the fix, and run the
whole loop again from stage 1, with fresh judges.

**Fix the class, not the instance.** A finding is one sighting. Before
rerunning, find its siblings: grep the stale wording everywhere it could
be stated, look for the same shape in the rest of the diff, and test the
neighbouring values. A fix that closes only the line the judge named
leaves the next round to find the one beside it.

**Cap it at five iterations.** If it has not passed by then, stop and take
it to the developer: five failed passes is a disagreement about what a
source means, and another iteration will not settle it.

## Commit

Commit exactly what was staged. A commit that changes anything after the
review — `git commit -a` with unstaged edits, a fixup — is a different tree
and needs its own review.

## When a judge is wrong

It will sometimes be, because the sources contradict themselves in places.
A finding that contradicts a later decision is resolved by the decision: if
no ADR or skill says it, the fix is to say it there — a judge should never
have to be argued with twice over the same point.

**Any finding a judge produces twice belongs in a deterministic stage.** A
Rust finding a lint can express becomes a workspace lint; a code finding
about structure becomes a test. That is what keeps the judges getting
cheaper instead of accumulating a longer checklist. The exception is a
finding no machine can tell from its lookalikes, such as a removed name
still in a comment: only reading says whether it is stale or history with
its pointer.

## What this does not cover

- **Whether the change is what the developer wanted.** That is the
  developer's to judge; the loop checks that it breaks nothing and holds to
  what the project has decided.
- **The judges are not reproducible, and no prompt fixes that.** Treat the
  findings as the output.
