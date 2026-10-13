# Diff Loop

Diff Loop is a desktop app with a Rust core and a [Tauri](https://tauri.app) front end.

Review what your coding agent wrote, then hand it back: Diff Loop shows the
diff for whatever branch or worktree is checked out, takes comments on
lines, ranges or with suggested code, and copies them as instructions to
paste into the agent's session.

## Install

Each release on this repository's Releases page carries:

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

## Release

Set the new version in `app/src-tauri/tauri.conf.json`,
`app/src-tauri/Cargo.toml` and `app/package.json` (then `cargo check` and
`npm install` update the lockfiles), commit, and push a tag `v<version>`.
The Release workflow refuses a tag that does not match
`tauri.conf.json`, builds the installers above and attaches them to a
draft release; publish it once the files are checked.

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
