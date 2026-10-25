# 0037 — A comment's kind is one enum

**Status:** accepted, 2026-10-25
**Amends:** ADR 0036 §1 (how the review file keeps a question, and how the kind is read)
**Affects:** `docs/spec/diff-loop-core.md`, `docs/spec/diff-loop-app.md`, `docs/spec/diff-loop-store.md`; `crates/core` (`Comment::ask`, `Ask`), `crates/mcp` and `crates/store` (their tests); `app/src` (the composer, `codeOf`)

## Context

ADR 0036 kept a question as `"question": true` beside the suggested code a
suggestion holds, and read the kind from the two: a question whatever code
it held, else a suggestion by its code. A pair whose combinations are not
all meant is what the quality gate asks an enum for, and the core and the
front end each repeated the reading. The developer chose an enum
(2026-10-25).

## Decision

1. **A comment holds what it asks of the agent as one value**, `ask`:
   `{"kind": "comment"}`, `{"kind": "question"}` or
   `{"kind": "suggestion", "code": "…"}` (`Ask` in the core, generated
   for the front end). Only a suggestion holds code; nothing reads the
   kind from other fields. The composer holds an `ask` too.
2. **A file written before it still reads**: a comment with no `ask`
   takes its kind from the fields ADR 0036 wrote (`question`, then
   `suggestion`), so the file stays at version 1; the next save writes
   `ask` and drops them.
3. What was sent keeps its code as before (`Sent::suggestion`): a
   snapshot, compared with the comment's code to tell it reopened.

The developer's call, 2026-10-25.

## Consequences

- A file saved by this build cannot be read by an earlier one, which
  needs `suggestion`; no release has shipped the review file yet (ADR
  0031 §1).
- An agent reading `get_review` or the file sees each comment's kind by
  name.
