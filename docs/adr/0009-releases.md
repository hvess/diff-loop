# 0009 — Releases for Linux and Apple Silicon

**Status:** accepted, 2026-10-13
**Affects:** `.github/workflows/release.yml`, `app/src-tauri/tauri.conf.json`,
`README.md`; open-tasks 12 and 13 (opened here)

## Context

Diff Loop ran only from source. The developer wants a consumer to download
the desktop app and install it, for Linux and macOS, for now.

## Decision

1. **A tag `v<version>` releases.** `.github/workflows/release.yml` builds
   on that tag and refuses one that does not match `tauri.conf.json`'s
   `version`. The installers go to a **draft** GitHub Release, published
   by hand once checked. (Amended by ADR 0028 §1 and §2: the workflow runs
   only when started by hand, and releases are built on the developer's
   Mac.)
2. **What a release carries:** an AppImage and a `.deb` for x86-64 Linux,
   and a `.dmg` for Apple Silicon only. The AppImage is the format for
   Arch and other distributions Tauri builds no package for; Intel Macs
   are not built for. The developer's call, 2026-10-13. (Amended by ADR
   0028 §3: a release carries those of these chosen for it; and by ADR
   0039: from 0.12.0 a release built here also carries an Intel `.dmg`.)
3. **Linux builds on Ubuntu 22.04**, the oldest Tauri supports, because an
   AppImage runs only where glibc is at least as new as the build's.
4. **macOS builds are ad-hoc signed** (`bundle.macOS.signingIdentity`
   `"-"`), not with a Developer ID, and not notarized: the README says how
   to open the app past Gatekeeper. The developer's call, 2026-10-13.

## Consequences

- No Windows build, though CI still checks Rust on Windows.
- No updater: a new version is downloaded and installed by hand.
- Every macOS user meets a Gatekeeper refusal on first launch until open
  task 12 closes.
