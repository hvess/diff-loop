# 0039 — Releases carry an Intel `.dmg` too

**Status:** accepted, 2026-10-27
**Amends:** ADR 0009 §2 (Intel Macs are not built for); ADR 0028 §2 (the
build command) and §3 (which installers a release carries)
**Affects:** `README.md` (Install), `CONTRIBUTING.md` (Releasing),
`docs/spec/diff-loop-app.md` (Decision 15), `site/index.html`,
`AGENTS.md`

## Context

Until 0.11.0 a release carried only an Apple Silicon `.dmg`, cross-compiled
on the developer's Intel Mac (ADR 0028 §2); Intel Macs were not built for
(ADR 0009 §2), so the developer could not install a release on the machine
that built it. On 2026-10-27, preparing 0.12.0, the developer asked for an
Intel build as well. The machine that builds releases is itself Intel, so
the build is native, and `x86_64-apple-darwin` is installed.

## Decision

1. **Each release built here carries two `.dmg`s**, from 0.12.0: Apple
   Silicon (`Diff.Loop_<version>_aarch64.dmg`) and Intel
   (`Diff.Loop_<version>_x64.dmg`), both ad-hoc signed as ADR 0009 §4
   says. The developer's call, 2026-10-27.
2. **The build runs once per target** in `app/`:
   `npm run tauri build -- --target aarch64-apple-darwin --bundles app,dmg`
   and the same with `--target x86_64-apple-darwin`. Both glass icons are
   compiled by Xcode 26's `actool` (ADR 0038).
3. **No universal binary.** Two files keep each download to one
   architecture's size; the Releases page and the website name which is
   which.
4. Linux installers stay as ADR 0028 §3 leaves them: chosen per release,
   built on Linux or by the Release workflow started by hand.

## Consequences

- A release takes two builds, a few minutes each on the developer's Mac.
- The Intel `.dmg` is checked on the machine that builds it; the Apple
  Silicon one still is not, until someone opens it on Apple Silicon.
- The Release workflow's macOS job still builds Apple Silicon only; it
  runs only for a release not built here (ADR 0028 §3).
