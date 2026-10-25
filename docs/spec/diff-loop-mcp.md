# diff-loop-mcp

A stdio MCP server through which a coding agent reads a branch's review and marks the comments it fixed as resolved.

**Status:** active — steps 1 to 5 landed; bundling and removing the guessing remain.
**Scope:** `crates/mcp` (new), the review file it shares with the app (`docs/spec/diff-loop-store.md`), and the app's side of an agent's marks.
**Owner:** Maximilian
**Last Updated:** 2026-10-25

## Why

The app guesses from the code whether the agent handled a comment (ADR
0015 §3), and the guess is flaky. Instead the agent says so: it marks a
comment resolved, through MCP or by editing the review file, and the
comment stays, so the reviewer can still see what was asked.

## How it works

1. The reviewer comments on a diff; each comment is saved, with its file
   and lines, in `.git/diff-loop/reviews/<branch>.json`.
2. Copy puts the instructions on the clipboard, naming the review file
   and each comment's id, and saying how to mark one resolved.
3. The agent fixes what it can and marks each fixed comment resolved,
   with a short note: through the MCP tool `resolve_comment`, or by
   editing the file.
4. The window sees the file change and shows the comment as resolved by
   the agent, with its note. R accepts it; editing the comment reopens it.

## Steps

1. **Review file** (ADR 0030, ADR 0031) — done 2026-10-25.
2. **Agent marks** (ADR 0032): a comment resolved by the agent, with its
   note (`Resolution::ByAgent`, `Comment::note`); a save keeps a mark the
   window has not seen (`SavedReview::keeping_agent_marks`) — done
   2026-10-25.
3. **Copy names the file and ids**, and says how to resolve
   (`instructions`' `kept_at`, `ReviewStore::location`) — done 2026-10-25.
4. **The window follows the file**: the store watches a review
   (`ReviewStore::watch`, the app's `watch_review`), and the window takes
   in the agent's marks (`takeAgentMarks`); the list offers Accept and
   Edit, with the agent's note — done 2026-10-25.
5. **The MCP server** (`crates/mcp`, `diff-loop-mcp`): `get_review` and
   `resolve_comment`, for the branch checked out in the agent's folder,
   JSON-RPC on stdio with no MCP library — done 2026-10-25.
6. **Bundle** the binary with the app, and show the command that
   registers it.
7. **Remove the guessing**: `Verdict` and the follow of ADRs 0017, 0021
   and 0022.

## Decisions

1. **The pointer is pasted.** An MCP server cannot write into the
   agent's session, so Copy is how a review reaches the agent. The
   developer's call, 2026-10-24.
2. **The agent resolves, and the comment stays.** Through MCP or the file
   alike (ADR 0032). The developer's call, 2026-10-25.
3. **No snapshots, threads or handed rounds.** The code is on the
   reviewer's machine and each comment keeps its lines; ADR 0032
   withdraws them from ADR 0030. The developer's call, 2026-10-25.
4. **A separate stdio binary**, over the same store as the app. The
   developer's call, 2026-10-24.
5. **The server finds the app's data as Tauri does** (`app_data` in
   `crates/mcp/src/main.rs`), by the app's identifier, which must match
   `app/src-tauri/tauri.conf.json`.

## Pitfalls

None yet.

## Progress (2026-10-25, the agent resolves)

Steps 2 to 5 landed: the agent resolves a comment with a note, through
`diff-loop-mcp` or the review file the copied instructions name, and the
window shows it as resolved by the agent until the reviewer accepts or
reopens it.

## Progress (2026-10-25, cut down)

The design was cut to the agent resolving comments in the review file
(ADR 0032). Step 1 had landed as `diff-loop-store` (ADR 0031).

## Progress (2026-10-24, design)

The first design, with snapshots, threads and handed rounds, was settled
and then withdrawn on 2026-10-25.
