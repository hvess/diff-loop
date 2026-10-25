# 0030 — The review file, in the project's git directory

**Status:** accepted, 2026-10-24; takes effect as `docs/spec/diff-loop-mcp.md`'s steps 1, 2 and 7 land
**Supersedes:** ADR 0017, ADR 0020, ADR 0021, ADR 0022; ADR 0015 §3, §8 and §9
**Amends:** ADR 0004 §2 and §3 (where reviews are kept, and their format); ADR 0015 §1 (what ends a round) and §4 (a suggestion applied resolves itself); ADR 0026 §8 (`reviews.json` version 4)
**Affects:** `docs/spec/diff-loop-mcp.md`, `docs/spec/diff-loop-core.md`, `docs/spec/diff-loop-app.md`; `crates/core` (`saved.rs`, `anchor.rs`, `rounds.rs`, `resume.rs`), `app/src-tauri/src/reviews.rs`; `crates/mcp` (new)

## Context

A round ends when the reviewer copies, and every load guesses each sent
comment's fate from the code (ADR 0015 §3), followed across the agent's
commits by ADRs 0017, 0021 and 0022. The guess is flaky. The developer
chose, 2026-10-24, an MCP server through which the agent hands over a
round and answers each comment (`docs/spec/diff-loop-mcp.md`). That server
is its own process, may run with the app closed, and the agent may read a
review without it; `reviews.json` in the app's data directory suits none
of that. ADR 0004 §2 chose the app-data directory over `.git/` so that
nothing was written into a reviewed repository; the developer reversed
that, 2026-10-24.

## Decision

1. **One file per branch, in the project's common git directory:**
   `<common git dir>/diff-loop/reviews/<name>.json`, where `<name>` is the
   branch as ADR 0026 §1 names it, with `%` written `%25` and `/` written
   `%2F`, so that every review is one file and `a` and `a/b` never collide.
   Every worktree of the project sees it, it is never committed, and it is
   gone with the project. The developer's call, 2026-10-24.
2. **The format**, version 1 of a new file:

   ```json
   {
     "version": 1,
     "branch": "agent/share-retry",
     "base": "main",
     "seen": "<commit>",
     "rounds": [{
       "number": 3,
       "opened_by": "agent",
       "opened": 1761300000000,
       "summary": "Retries now back off…",
       "handed": { "commit": "<HEAD>", "snapshot": "<commit>" },
       "finished": 1761303600000,
       "sent": { "commit": "<HEAD>", "snapshot": "<commit>" }
     }],
     "comments": [{
       "id": "…",
       "target": "…",
       "code": "…",
       "state": "open",
       "thread": [
         { "by": "reviewer", "round": 3, "at": 1761301000000, "text": "…", "suggestion": "…" },
         { "by": "agent", "round": 4, "at": 1761305000000, "status": "fixed", "text": "…" }
       ]
     }]
   }
   ```

   `opened_by` is `agent` or `reviewer`; `handed` is set only when the
   agent opened the round (`request_review`), `finished` and `sent` when
   the reviewer finished it. A comment's `state` is `open`, `awaiting`
   (the agent said `fixed`) or `resolved`, and `status` is the agent's
   `fixed`, `declined` or `question`. `target` and `code` are `Comment`'s
   as today. A file of another version, or that does not parse, is
   reported and never overwritten (as ADR 0004 §3). The last 20 rounds are
   kept, as ADR 0015 §9 kept them. (Amended by ADR 0031 §1: the shape
   grows with the spec's steps, at version 1.)
3. **A snapshot is a commit of the working tree, kept by a ref.** Taken
   through a temporary index, untracked files included and the checkout
   untouched, its parent the round's `HEAD`; kept by
   `refs/diff-loop/<name>/<number>`, with `<name>` as in §1, so `git gc`
   does not collect it. A round dropped, by the bound or a rewrite (ADR
   0026 §4), deletes its refs. The developer's call, 2026-10-24.
4. **Saves take turns on a lock beside the file** (`<name>.json.lock`),
   held across read, change and write, by the app and the server alike;
   each save writes `<name>.json.next` and renames it over the file.
   Reads take no lock. The app watches `diff-loop/reviews/` for the
   server's saves. (Amended by ADR 0031 §4: the watch ignores the folder
   until the MCP spec's step 6.)
5. **Nothing is guessed.** A comment's outcome is the agent's reply and the
   reviewer's resolution; `Verdict`, its judgement at every load and the
   follow of ADRs 0017, 0021 and 0022 go. A comment moves to its new lines
   by diffing the snapshot it was sent on with the next round's handed
   snapshot, and between rounds with the live diff, as `reanchor` does
   today. A suggestion found applied no longer resolves itself.
6. **Finishing a round ends it,** not copying (amends ADR 0015 §1):
   Finish Round records `sent` and copies the pointer and the Markdown.
7. **`reviews.json` is no longer read.** Its reviews are dropped and the
   file left as it is (the developer's call, 2026-10-24: no migration);
   nothing prunes reviews, since they go with their project, and a deleted
   branch's file and refs go with it (ADR 0026 §6). (Amended by ADR 0031
   §2: the projects that hold a review are listed in `projects.json`.)

## Consequences

- Diff Loop writes into a reviewed repository's git directory and refs for
  the first time. A plain `git push` sends no `refs/diff-loop/` ref; a
  `--mirror` push does, and `git log --all` and `gitk --all` show the
  snapshots.
- On a case-insensitive file system two branches differing only in case
  share a file and a ref, as git's own loose refs do.
- An agent without MCP can be pointed at the file.
- The app-data directory keeps only the window's own state, `open/`'s
  claims (ADR 0026 §9) among it.
- An earlier build finds no reviews; a later build never reads what an
  earlier one wrote to `reviews.json`.
