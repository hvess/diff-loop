# 0025 — CI runs only for a release

**Status:** accepted, 2026-10-17
**Supersedes:** ADR 0024
**Amends:** ADR 0006, Consequences (CI runs the stages on every push: now
only for a release)
**Affects:** `.github/workflows/ci.yml`

## Context

ADR 0024 kept a Linux check on every push to stay inside the month's
2,000 Actions minutes. That check repeats what the local commit gate
already ran on the same tree (ADR 0007): no agent commit reaches `main`
without stages 1–3 passing. The developer chose to run CI only when a
release is cut, 2026-10-17.

## Decision

1. **CI runs on a `v*` tag, or by hand** (`workflow_dispatch`, to check
   the other platforms before tagging); no push to a branch and no pull
   request starts it. (Amended by ADR 0028 §1: a tag no longer starts it;
   it runs only by hand.)
2. **When it runs, it runs everything**: the Rust job on Linux, macOS and
   Windows, and the front end's job on Linux, so a platform break shows
   before a release's draft is published (ADR 0001).
3. **`release.yml` is unchanged**: the AppImage, `.deb` and `.dmg` are
   built for every version tag. (Amended by ADR 0028 §1: a tag starts
   neither workflow; both run only when started by hand.)

## Consequences

- Between releases, only the local gate checks a commit, and only on the
  platform it runs on; a macOS- or Windows-only break is found at the
  next manual run (at the next tag too, until ADR 0028).
- A commit made without the gate (a person's, where `AGENT` is unset) is
  checked by nothing until CI is next started by hand.
