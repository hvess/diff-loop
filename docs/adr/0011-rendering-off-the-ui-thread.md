# 0011 — Highlighting off the UI thread, and the React Compiler

**Status:** accepted, 2026-10-14
**Affects:** `app/src/highlight.ts`, `app/src/highlight.worker.ts`,
`app/vite.config.ts`, `app/package.json`, `app/src/components/FilePane.tsx`;
the `frontend` skill's Cost section

## Context

ADR 0010 made the window behave natively; what remains of feeling native is
that no key or click waits on rendering. Shiki tokenized on the UI thread
(`MAX_LINES` in `highlight.ts` existed for that reason), so opening a large
file held up input, and the full `shiki` bundle loaded every language list
into the main chunk. Components were memoized by hand.

## Decision

1. **Tokenizing runs in a Web Worker** (`highlight.worker.ts`), built from
   Shiki's fine-grained modules (`shiki/core`, `shiki/engine/javascript`,
   `shiki/langs`), each language loaded on first use. `highlight.ts` sends
   each side's lines and places the tokens it gets back; highlights are
   cached per `FileDiff` and its expansions in a `WeakMap`, so returning to
   a file shows them at once. A worker that fails leaves every file plain
   rather than waiting. `MAX_LINES` stays, now bounding the worker's time and
   the tokens sent back.
2. **The React Compiler** (`babel-plugin-react-compiler` 1.0, a new
   development dependency) memoizes components and hooks at build time,
   through `@vitejs/plugin-react`'s Babel option.
3. **The selected file renders deferred** (`useDeferredValue` in
   `FilePane`): the sidebar marks a new selection at once, and moving
   through files with the arrow keys never waits for a diff to render.

## Consequences

- The main chunk no longer carries Shiki; the worker is its own chunk.
- `content-visibility` is not used: every long list is virtualized
  (TanStack Virtual, ADR 0001), and the others hold a handful of items.
- A component the compiler cannot prove safe is left as written, silently;
  hand memoization there still counts.
