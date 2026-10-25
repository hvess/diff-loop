<p align="center">
  <img src="docs/icon.png" width="128" height="128" alt="">
</p>

<h1 align="center">Diff Loop</h1>

<p align="center">Review what your agent wrote, then hand it back.</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="Platform: macOS | Linux">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
</p>

![Diff Loop reviewing a branch: the file tree on the left, the diff of handler.ts on the right with a comment on line 12](docs/review-screen.png)

Diff Loop is a desktop app for reviewing what a coding agent changed. It
shows the diff for whatever branch or worktree is checked out, takes
comments on lines, ranges or whole files, with suggested code if you like,
and copies them as instructions to paste into the agent's session. It has
a Rust core and a [Tauri](https://tauri.app) front end.

## How it works

1. **Open a repository.** Diff Loop shows what the checked-out branch
   changed compared with a base branch, or only the uncommitted changes,
   or only the last commit. It follows the files as the agent edits them.
2. **Comment.** Click a line's number or drag down the numbers, and
   write a comment saying what should change, a question for the agent
   to answer, or the code you want in its place.
3. **Copy the review and paste it into your agent.** When it has made its
   changes, the next round shows each comment you sent as untouched,
   changed, removed or applied. Resolve the ones that are done; the rest
   go out again under "Still open".

## What you paste into your agent

````text
Review of agent/share-rate-limit (compared with main): 1 comment, 1 question and 1 suggestion.

## 1. Address these comments
Change the code so each comment is dealt with.

### config/limits.yaml
- L5 `maxPerWindow: 20`: Make this configurable per plan. (id `a2d7f419-…`)

## 2. Answer these questions
Answer each one. Don't change any code for them.

### src/api/share/handler.ts
- L9 `const limit = await checkShareLimit(userId);`: Should a failed share count against the limit? (id `e41b7c03-…`)

## 3. Implement these suggestions
Replace the lines named with the suggested code, as written. If it no longer fits the code around it, leave it and say why.

### src/api/share/handler.ts
- L12 `log.warn('share rate limited', { userId });`: Don't log the raw userId. Hash it first. (id `c94d0e57-…`)
  ```ts
  log.warn('share rate limited', { user: hashUserId(userId) });
  ```

## When you're done
These are kept in `/Users/you/code/drive-web/.git/diff-loop/reviews/agent%2Fshare-rate-limit.json`. Mark each one you dealt with resolved, with a one-line note saying what you changed or giving your answer: call `resolve_comment` on the `diff-loop` MCP server with its id and the note, or, without it, set its `"resolved"` to `"byAgent"` and its `"note"` to the note in that file, changing nothing else. Leave anything you did not do as it is.
````

## Install

A release on this repository's Releases page carries some of these, as
chosen for it (0.9.0 to 0.11.0 carry only the `.dmg`):

| File | For |
|---|---|
| `Diff.Loop_<version>_amd64.AppImage` | Any x86-64 Linux, Arch included |
| `Diff.Loop_<version>_amd64.deb` | Debian and Ubuntu |
| `Diff.Loop_<version>_aarch64.dmg` | Macs with Apple Silicon |

The repository is private, so downloading needs access to it.

**Linux, AppImage.** Make it executable and run it; it needs FUSE 2
(`pacman -S fuse2` on Arch, `libfuse2` on Debian and Ubuntu):

```sh
chmod +x Diff.Loop_*_amd64.AppImage
./Diff.Loop_*_amd64.AppImage
```

**Debian and Ubuntu.** `sudo apt install ./Diff.Loop_*_amd64.deb`, then
open Diff Loop from the app launcher.

**macOS.** Open the `.dmg` and drag Diff Loop to Applications. The app is
not signed with an Apple Developer ID yet, so macOS refuses to open it the
first time: choose **Open Anyway** in System Settings › Privacy & Security,
or clear the quarantine flag once:

```sh
xattr -dr com.apple.quarantine "/Applications/Diff Loop.app"
```

## Connect your agent

The copied instructions name the review file, so an agent can mark what it
dealt with without any setup. With the `diff-loop` MCP server it does so
through `get_review` and `resolve_comment` instead. The server is not in
the installers yet; build it from source (see Run from source):

```sh
cargo build --release -p diff-loop-mcp
```

Then register `target/release/diff-loop-mcp` with your agent. Claude Code:

```sh
claude mcp add diff-loop -- /path/to/diff-loop/target/release/diff-loop-mcp
```

Codex:

```sh
codex mcp add diff-loop -- /path/to/diff-loop/target/release/diff-loop-mcp
```

The server reads the review of the branch checked out where it starts,
so start the agent in the repository you are reviewing.

## Release

Releases are built on a Mac, not by Actions (ADR 0028). Set the new
version in `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`
and `app/package.json` (then `cargo check` and `npm install` update the
lockfiles) and commit. Build the Apple Silicon installer:

```sh
cd app
npm run tauri build -- --target aarch64-apple-darwin --bundles app,dmg
```

Push a tag `v<version>`, then attach
`target/aarch64-apple-darwin/release/bundle/dmg/Diff Loop_<version>_aarch64.dmg`
to a draft release (`gh release create v<version> --draft <file>`);
publish it once the file is checked. The Release workflow, started by
hand on the tag, builds every installer itself, the `.dmg` included: use
it only for a release not built here.

## Run from source

Needs Rust 1.99, Node 22 with npm, `git`, and Tauri's
[system dependencies](https://tauri.app/start/prerequisites/).

```sh
cd app
npm install
npm run tauri dev
npm run tauri dev -- -- -- ~/code/my-repo   # open a repository on launch
```

`cargo test --workspace` runs the Rust tests and regenerates the
TypeScript bindings in `app/src/bindings/`.

## License

[MIT](LICENSE)
