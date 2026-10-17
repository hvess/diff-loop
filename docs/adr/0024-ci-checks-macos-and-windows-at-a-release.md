# 0024 — CI checks macOS and Windows at a release, Linux on every push

**Status:** superseded by ADR 0025, 2026-10-17
**Amends:** ADR 0006, Consequences (the Rust jobs stay on three
platforms: now on a version tag or a manual run; a push checks Linux)
**Affects:** `.github/workflows/ci.yml`

## Context

GitHub Actions minutes on a private repository are billed with a
multiplier: a macOS minute counts as 10, a Windows minute as 2. CI ran
clippy and the tests on Linux, macOS and Windows for every push to
`main`, and agents push often; by 2026-10-17 the month had used 1,800 of
its 2,000 minutes with 15 days left. Every agent commit already passes
the same stages on Linux before it is made (ADR 0007). The developer
needs the macOS and Linux release builds (ADR 0009) to keep running,
2026-10-17.

## Decision

1. **A push to `main`, or a pull request, checks Linux only**: the Rust
   job on `ubuntu-24.04` and the front end's job, as before.
2. **macOS and Windows join the Rust job on a `v*` tag and on a manual
   run** (`workflow_dispatch`), so a platform break shows before a
   release is published, as ADR 0001 asks, and can be checked by hand
   before tagging.
3. **A push that changes only `docs/` or Markdown runs no CI**; the
   records it changes have no stage to run (the review skill: a change
   with no judge passes when stages 1–3 pass, which the local gate ran).
4. **A newer push cancels the run of an older one on the same ref**,
   whose result no longer describes the tree.
5. **`release.yml` is unchanged**: the AppImage, `.deb` and `.dmg` are
   built for every version tag.

## Consequences

- A change that breaks only macOS or Windows is found at the next tag
  or manual run, not at its push; the release's draft is not published
  until its checks pass.
- A release still costs its macOS build and checks at the 10x rate.
