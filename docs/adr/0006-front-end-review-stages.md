# 0006 — The front end's review stages

**Status:** accepted, 2026-10-13
**Amends:** ADR 0001 §2 (adds development dependencies)
**Affects:** open-tasks 2 (closed here); `.agents/skills/review/SKILL.md`,
`.agents/skills/frontend/SKILL.md`, `.github/workflows/ci.yml`

## Context

The review loop ran only Rust's stages, so a front-end change landed with
no lint, no type check and no judge, and nothing checked what the window
looks like.

## Decision

1. **ESLint** lints `app/` (`npm run lint`, `app/eslint.config.js`): the
   recommended rules of ESLint, typescript-eslint and React's hooks
   plugin, no warning allowed, the generated bindings left out. Nothing is
   added to them: a rule the code breaks is fixed in the code.
2. **The front end's stages** join the review loop and CI: `npm run
   lint`, `npm run typecheck` and `npm test` (ADR 0003), then `npm run
   build`.
3. **A front-end skill** (`.agents/skills/frontend/SKILL.md`) states the
   idioms the code follows; the code judge reads it for any change under
   `app/src`.
4. **A UI judge** reads windows the author captures, light and dark, of
   every view the change alters, against the `ux` skill.

## Consequences

- The UI judge sees only the states the author captures; it cannot click.
- CI installs the front end's dependencies on one platform; the Rust jobs
  stay on three.
