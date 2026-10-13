# Diff Loop

Diff Loop is a desktop app with a Rust core and a [Tauri](https://tauri.app) front end.

Review what your coding agent wrote, then hand it back: Diff Loop shows the
diff for whatever branch or worktree is checked out, takes comments on
lines, ranges or with suggested code, and copies them as instructions to
paste into the agent's session.

## Run

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
