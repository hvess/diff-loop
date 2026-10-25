# 0032 — The agent resolves comments in the review file

**Status:** accepted, 2026-10-25
**Amends:** ADR 0030 §2 (threads, comment states and handed rounds withdrawn), §3 (snapshots withdrawn), §5 and §6; ADR 0031 §1 (the shape the file grows to) and §4 (the app not watching the server's saves); ADR 0015 §4 (who resolves)
**Affects:** `docs/spec/diff-loop-mcp.md`; `crates/core/src/anchor.rs` (`Resolution`, `Comment::note`), `crates/store`, `crates/mcp` (new); `app/src-tauri/src/lib.rs` (`watch_review`, `keep_agent_marks`, `instructions`); the front end's comment card, list, margin note and bottom bar

## Context

ADR 0030 planned round snapshots kept by refs, comment threads and rounds
the agent hands over. The developer found it far heavier than the need
(2026-10-25): the code is on the reviewer's machine, each comment already
keeps its file and lines, and what is missing is only a way for the agent
to say it fixed a comment.

## Decision

1. **The agent resolves a comment** (`Resolution::ByAgent`), with a note
   saying what it changed (`Comment::note`; the MCP tool asks for one, and
   an empty one is kept as none), through the MCP server or by editing
   the review file. The comment stays, resolved, so the reviewer can see
   what was asked.
2. **The reviewer has the last word.** A comment the agent resolved stays
   on its lines, marked "Resolved by agent" with the note, until the
   reviewer accepts it (R, or Accept: `ByReviewer`) or edits it, which
   reopens it and clears the mark. The developer's call, 2026-10-25.
3. **A save keeps a mark the window has not seen**: a comment the file
   holds resolved by the agent stays so while the window's copy is open
   and unedited (`SavedReview::keeping_agent_marks`), so a save racing
   the agent's edit loses nothing; and the server changes the file in one
   locked step (`ReviewStore::change`), so it loses none of the window's.
4. **The window follows its review's file** (`ReviewStore::watch`) and
   takes in what changed there.
5. **No snapshots, threads or handed rounds.** ADR 0030 §3 and its
   `refs/diff-loop/` go unbuilt; a round stays what a copy records, and a
   comment moves to its new lines as `reanchor` moves it today, not by
   diffing snapshots (ADR 0030 §5).

## Consequences

- Nothing is written into a repository but its review files, and the
  empty folder a watch makes for them.
- An agent without MCP needs only to edit a JSON file it is pointed at.
- A comment resolved by the agent that the reviewer neither accepts nor
  edits stays resolved by the agent.
