# diff-loop-mcp

A stdio MCP server through which a coding agent hands rounds to Diff Loop and answers the reviewer's comments, so a round's boundary and each comment's outcome are stated rather than guessed.

**Status:** active — step 1 landed (`diff-loop-store`); the rest designed, not built.
**Scope:** `crates/mcp` (new), the review file it shares with the app, and the app's side of rounds. Excludes the diff view itself.
**Owner:** Maximilian
**Last Updated:** 2026-10-25

## Why

A round today ends when the reviewer copies, and each sent comment's fate
(untouched, nearby changed, changed, removed, applied; ADR 0015) is
inferred from later loads, followed across commits (ADRs 0017, 0021,
0022). The inference is flaky. With MCP the agent says when it hands over
and what it did with each comment.

## Steps

1. **Review file** (ADR 0030). One file per branch at
   `<common git dir>/diff-loop/reviews/<name>.json`, read and written by app and
   server under a lock beside it; replaces `reviews.json` — done
   2026-10-25, holding today's review (ADR 0031 §1), in
   `diff-loop-store`.
2. **Snapshots.** A round records the tree the agent handed over: the
   working tree, untracked files included, written to git's object store
   through a temporary index, never touching the checkout — not started.
3. **Threads.** A comment is an ordered thread of the reviewer's and the
   agent's messages across rounds; a comment's state is open, awaiting
   the reviewer, or resolved — not started.
4. **Tools.** `request_review(summary)`, `get_round(branch?)`,
   `respond(comment_id, fixed | declined | question, note)` — not started.
5. **Opening.** `request_review` launches Diff Loop, or brings it
   forward, on that branch's review at the new round — not started.
6. **App.** Watches the review file; shows the agent's replies in threads;
   Finish Round copies a pointer line plus the full Markdown, with comment
   ids — not started.
7. **Remove the guessing.** `Verdict` and the follow logic of ADRs 0015,
   0017, 0021 and 0022 go; a comment moves to its new lines by diffing one
   round's tree with the next — not started.
8. **Bundle.** The binary ships in each installer as a Tauri sidecar; the
   app shows the command that registers it with an agent — not started.

## Decisions

1. **The pointer is pasted; no tool blocks.** `request_review` returns at
   once. When the reviewer finishes a round, they paste the copied pointer
   (and Markdown) into the agent's session, and the agent calls
   `get_round`. The developer's call, 2026-10-24.
2. **The agent answers each comment.** `respond` with a status and a note,
   shown in the comment's thread. The developer's call, 2026-10-24.
3. **The reviewer resolves.** `fixed` marks a comment awaiting the
   reviewer, who resolves it (R) or reopens it with a reply; `declined`
   and `question` stay open. A thread with a new message from the reviewer
   is sent again next round. The developer's call, 2026-10-24.
4. **No guessing without MCP.** Copying Markdown still works for any
   agent; its comments stay open until the reviewer resolves them. The
   developer's call, 2026-10-24.
5. **Either side starts a round.** The agent with `request_review`, or the
   reviewer commenting on any branch, as today. The developer's call,
   2026-10-24.
6. **A separate stdio binary.** It works with the app closed and opens the
   app itself; the app learns of changes by watching the review file. The
   developer's call, 2026-10-24. (Since ADR 0031 §4 the watch ignores
   Diff Loop's folder; step 6 decides how the app sees the server's saves.)
7. **Reviews live in the git directory.** Every worktree sees them, they
   are never committed, and an agent can read one without MCP. Reviews in
   `reviews.json` version 4 are dropped, the file left untouched. The
   developer's call, 2026-10-24.
8. **The agent leaves no line notes yet.** Only a round summary and
   replies; notes anchored to lines can come later. The developer's call,
   2026-10-24.

## Open

- Whether the core gains a port for snapshots, or `Repository` grows one.
- The pointer line's exact wording, and how `get_round` finds the branch
  when the agent's working directory is another worktree.

## Pitfalls

None yet.

## Progress (2026-10-25, the review file)

Step 1 landed as `diff-loop-store` (ADR 0031): a file per branch in
the project's git directory, holding today's review; `projects.json`
lists the projects that hold one.

## Progress (2026-10-24, ADR 0030)

ADR 0030 records the review file's place and format, snapshots kept by
refs under `refs/diff-loop/`, and the end of the guessing; nothing is
built.

## Progress (2026-10-24, design)

The design was settled in conversation with the developer; nothing is
built.
