# Contributing to Diff Loop

## Build and run

You need Rust through [rustup](https://rustup.rs) (`rust-toolchain.toml`
pins the version), Node 22 with npm, `git`, and Tauri 2's
[system prerequisites](https://tauri.app/start/prerequisites/). On
Debian and Ubuntu, `.github/workflows/ci.yml` lists the packages. A macOS
release build also needs Xcode 26, for the Liquid Glass icon (ADR 0038).

```sh
cd app
npm install
npm run tauri dev
```

The MCP server builds on its own:

```sh
cargo build --release -p diff-loop-mcp
```

## Checks before a pull request

Run these from the repository's root:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

`cargo test --workspace` also regenerates the TypeScript types in
`app/src/bindings/` from the Rust ones. Commit what it changes there, and
never edit those files by hand.

Then, in `app/`:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

CI does not run on pushes or pull requests. Both workflows run only when
a maintainer starts them by hand (ADR 0025, ADR 0028), so run the checks
locally before you open a pull request.

## The project's records

- **Specs** in `docs/spec/`, one per crate (`diff-loop-core.md`,
  `diff-loop-app.md`, and so on). Read the relevant one before changing a
  crate.
- **Decision records** in `docs/adr/`, numbered `NNNN-title.md`. A change
  that alters a stated decision, a constraint or a persisted format comes
  with a new ADR. Read the ones that cover a decision before reopening it.
- **The open-tasks ledger**, `docs/spec/diff-loop-open-tasks.md`: known,
  understood, undone work, each entry citing its evidence.

`AGENTS.md` summarises every ADR and states the constraints that are not
up for change, such as the core depending on no Tauri crate and no other
workspace crate.

## For AI coding agents

`AGENTS.md` and the skills in `.agents/skills/*/SKILL.md` are your
instructions. They are plain Markdown, whatever agent you are.

The commit gate in `.githooks/` refuses a commit made by an agent, one
whose environment sets `AGENT` or Claude Code's `CLAUDECODE`, unless the
review loop in `.agents/skills/review/SKILL.md` passed for exactly the
tree being committed. The hooks run only once a checkout installs them:

```sh
cargo run -q -p diff-loop-review -- install-guard
```

Human contributors are not gated: without `AGENT` or `CLAUDECODE` the
hook lets the commit through.

## Releasing

Maintainers build releases on a Mac, not with Actions (ADR 0028). Set the
new version in `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`
and `app/package.json` (then `cargo check` and `npm install` update the
lockfiles) and commit. Build the Apple Silicon installer, which needs
Xcode 26 for the Liquid Glass icon:

```sh
cd app
npm run tauri build -- --target aarch64-apple-darwin --bundles app,dmg
```

Push a tag `v<version>`, then attach
`target/aarch64-apple-darwin/release/bundle/dmg/Diff Loop_<version>_aarch64.dmg`
to a draft release (`gh release create v<version> --draft <file>`), and
publish it once the file is checked. The Release workflow, started by
hand on the tag, also builds the Linux installers; its macOS job may not
build the glass icon yet (`docs/spec/diff-loop-open-tasks.md`, task 29).
