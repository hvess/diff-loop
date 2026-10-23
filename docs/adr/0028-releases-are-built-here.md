# 0028 — Releases are built here

**Status:** accepted, 2026-10-23
**Amends:** ADR 0009 §1 (a tag no longer builds the installers) and §2
(which installers a release carries is chosen per release), ADR 0025 §1
and §3 (a tag no longer starts CI or the Release workflow)
**Affects:** `.github/workflows/release.yml`, `.github/workflows/ci.yml`,
`README.md`, `docs/spec/diff-loop-app.md` (Decision 15),
`docs/spec/diff-loop-open-tasks.md` (task 12), `AGENTS.md`

## Context

This private repository's GitHub Actions minutes are used up (the
developer, 2026-10-22), so a `v*` tag, which starts both workflows, would
start two runs that cannot finish, or, once minutes return, a Release run
racing the files built here. The developer chose to build releases on
their own Mac, 2026-10-23.

## Decision

1. **Both workflows run only when started by hand** (`workflow_dispatch`);
   a tag starts neither. The Release workflow, started on a tag's ref,
   still refuses one that does not match `tauri.conf.json`'s `version`.
2. **A release is built on the developer's Mac**: the version set and
   committed through the gate, then `npm run tauri build -- --target
   aarch64-apple-darwin --bundles app,dmg` in `app/` (cross-compiled from
   an Intel Mac), ad-hoc signed as ADR 0009 §4 says, the tag `v<version>`
   pushed, and the files attached to a **draft** GitHub Release with the
   `gh` CLI, published by hand once checked (ADR 0009 §1).
3. **Which installers a release carries is chosen per release.** 0.9.0
   carries only the Apple Silicon `.dmg` (the developer's call,
   2026-10-23); a Linux installer needs a Linux machine, or the Release
   workflow started by hand, which also builds and attaches a `.dmg` of
   its own: started only for a release not built here.

## Consequences

- No check runs on Linux, macOS or Windows for a release unless CI is
  started by hand; the local gate (ADR 0007) is the only check on the
  platform it runs on.
- The Releases page's files vary by release, and the README says so.
