# 0008 — Type-aware lint, and exact optional properties

**Status:** accepted, 2026-10-13
**Amends:** ADR 0006 §1 (the lint stage's rules)
**Affects:** `app/eslint.config.js`, `app/tsconfig.json`, `app/src/store.ts`,
`.agents/skills/frontend/SKILL.md`

## Context

An audit of `app/src` against the `mastering-typescript` skill found the
lint stage ran typescript-eslint's rules without type information, so a
promise nobody handles or awaits went unchecked. The code had none, but
nothing kept it so. Turned on, the type-aware rules found 29
`unbound-method` errors, all from the store's actions being declared as
methods; method syntax also lets an action's parameters be checked
bivariantly.

## Decision

1. **The lint stage runs typescript-eslint's `recommendedTypeChecked`**
   in place of `recommended`, over `tsconfig.json`'s files; files
   outside it (`eslint.config.js`) get the rules without types. As in
   ADR 0006 §1, nothing else is added, and a rule the code breaks is
   fixed in the code.
2. **The store's actions are function-typed properties**, not methods
   (`open: (path: string) => Promise<void>`), so a component may take one
   out of the store and call it alone.
3. **`exactOptionalPropertyTypes` is on**: an optional property that may
   hold `undefined` says so in its type.

## Consequences

- Lint now reads types, so it is slower than before.
- `noPropertyAccessFromIndexSignature`, which the same audit tried, is
  not adopted: its 11 sites are the checked reads of stored JSON, where
  `s["format"]` says nothing `s.format` does not. The developer's call,
  2026-10-13, on the audit's recommendation.
