# diff-loop-git

The `Repository` adapter over the `git` command line.

**Status:** active — first version landed.
**Scope:** `crates/git`. Excludes everything the core decides.
**Owner:** Maximilian
**Last Updated:** 2026-10-13

## Why

ADR 0001 §4: the app reads git as the terminal does, with no native library.

## Steps

1. Open a working tree from any folder inside it — done 2026-10-13.
2. Resolve each `Base` to two trees (`Snapshot`) and diff them — done 2026-10-13.
3. Parse `git diff` output — done 2026-10-13.
4. Untracked files as additions, binary sizes, blobs, fingerprint, commits between — done 2026-10-13.
5. Watch the working tree and its git directories (ADR 0002) — done 2026-10-13.
6. Find git as a terminal does (Decisions 8 and 9) — done 2026-10-13.
7. `changes_in`: the changes under given paths (ADR 0005 §2) — done 2026-10-13.

## Decisions

1. **Bases:** `Ref` diffs the merge base of the ref and `HEAD` against the
   working tree; `Uncommitted` diffs `HEAD` (or the empty tree) against
   the working tree; `LastCommit` diffs `HEAD^` (or the empty tree)
   against `HEAD`. Untracked, unignored files are added for working-tree
   bases.
2. **Untracked files are read from disk**, not one `git diff --no-index`
   each; a NUL in the first 8000 bytes makes one binary, as git does, and
   a binary is read no further than that. An untracked path git also
   reports as tracked (removed from the index, still on disk) is left
   out, so each path appears once in `Changes::files`.
3. **Forced config:** `core.quotePath=false`, prefixes `a/` and `b/`, no
   external diff or textconv, renames on. `parse` relies on these.
4. **The fingerprint** hashes the snapshot, the tracked diff and each
   untracked file's path, size and mtime. It is compared only within one
   run (`DefaultHasher` is not stable across Rust versions). Cost: one
   `git diff` per check, which runs on focus or the 2 s poll only when
   nothing watches (ADR 0005 §4).
5. **Blobs refuse paths that leave the tree**, on either side: only
   normal components (`relative`), and a working-tree path must
   canonicalize inside the root. A failed file operation reports its path
   (`failed`).
6. **The watch** covers the working tree recursively, plus the git
   directory and common directory when they lie outside it (a worktree),
   and reports a burst of events once after 250 ms of quiet
   (`watch.rs`, `SETTLE`), with the working-tree paths it touched
   (ADR 0005 §1). Dropping the guard stops it and its thread.
7. **Stdin is written on its own thread** (`command.rs`): git can fill
   its stdout pipe before it has read all its input.
8. **Git is found as a terminal finds it** (`locate.rs`), once per
   `Git::open`: the first `git` on `PATH`; else, on Unix, the file
   `$SHELL -lc 'command -v git'` names, since an app opened from the
   macOS Finder gets a minimal `PATH`; else plain `git`, which fails with
   a message naming where it looked (`MISSING`). The developer's call,
   2026-10-13.
9. **The login shell gets 5 s to exit** (`SHELL_TIMEOUT`), then is
   killed, so a profile that waits on input cannot hang opening a
   repository. It writes to a temporary file, not a pipe: a background
   process the profile starts could hold a pipe open after the shell
   exits. The file is created with `create_new`, so a file or symlink
   planted at its name is refused, never followed. Its last line of output
   is the answer. Chosen by the author,
   2026-10-13.

10. **Pathspecs are literal** (`GIT_LITERAL_PATHSPECS`, `command.rs`):
    a touched file may be named `*.ts`. `changes_in` with no paths reads
    no files, since git reads an empty pathspec as every path.

## Pitfalls

- A hunk is read by its line counts, never by looking for the next
  `diff --git`: a changed line can start with that text.
- `git diff --git` headers are ambiguous for paths with spaces; only an
  identical pair is split from the header, and renames take their paths
  from `rename from` / `rename to`.

## Progress (2026-10-13, reading only what was touched)

Step 7 landed; the watch names what it touched (ADR 0005).

## Progress (2026-10-13, git through the login shell)

Decisions 8 and 9 landed: an app without `git` on its `PATH` asks the
login shell, and gives up on one that has not exited within 5 s.

## Progress (2026-10-13, first version)

Landed with tests against real repositories in temporary directories.
