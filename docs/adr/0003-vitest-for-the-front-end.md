# 0003 — Vitest for the front end's tests

**Status:** accepted, 2026-10-13
**Amends:** ADR 0001 §2 (adds a development dependency)
**Affects:** open-tasks 2; `docs/spec/diff-loop-app.md`

## Context

The front end had no tests: logic in `app/src` (rows, gaps, ordering)
could change with nothing to catch it, and a fix there could not land
with the test quality-gate §8 asks for.

## Decision

1. **Vitest** runs the front end's tests (`npm test` in `app/`, which is
   `vitest run`). It is Vite's own test runner: it reads `vite.config.ts`
   and the same TypeScript, so tests need no second build setup.
2. **Tests sit beside the module they test**, as `<module>.test.ts`, and
   test plain functions (and, since ADR 0004 §6, the store with `api`
   mocked); components are checked by use (`ux` skill, gate
   9) until a UI judge exists (open-tasks 2).

## Consequences

- `npm test` joins the front end's stages when the review skill gains
  them (open-tasks 2).
- `tsc --noEmit` type-checks the tests with the rest of `app/src`.
