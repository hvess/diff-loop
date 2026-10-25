# diff-loop-git

The `Repository` and `Project` adapters over the `git` command line.

**Status:** active — first version landed.
**Scope:** `crates/git`. Excludes everything the core decides.
**Owner:** Maximilian
**Last Updated:** 2026-10-25

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
8. Behind counts on refs, and the uncommitted file count — done 2026-10-13; replaced 2026-10-17 by step 9.
9. Ref dates, newest first, and the uncommitted line counts (Decision 11) — done 2026-10-17.
10. Reviews per branch (ADR 0026): a branch no worktree has checked out, read from its commits (`Git::for_branch`, Decision 12), and a project's branches with where each is checked out (`GitProject`, Decision 13) — done 2026-10-19.

## Decisions

1. **Bases:** `Ref` diffs the merge base of the ref and `HEAD` against the
   working tree; `Uncommitted` diffs `HEAD` (or the empty tree) against
   the working tree; `LastCommit` diffs `HEAD^` (or the empty tree)
   against `HEAD`. Untracked, unignored files are added for working-tree
   bases. A branch with no working tree (Decision 12) puts its commit for
   `HEAD` and for the working tree, and refuses `Uncommitted`.
2. **Untracked files are read from disk**, not one `git diff --no-index`
   each; a NUL in the first 8000 bytes makes one binary, as git does, and
   a binary is read no further than that. An untracked path git also
   reports as tracked (removed from the index, still on disk) is left
   out, so each path appears once in `Changes::files`.
3. **Forced config:** `core.quotePath=false`, prefixes `a/` and `b/`, no
   external diff or textconv, renames on. `parse` relies on these.
4. **The file states and fingerprint** (`states.rs`; ADR 0023): against
   the working tree, by path, a hash of what git says of each file that
   differs (its `git diff --raw` record: modes, ids and status, no
   contents; `raw::raw_records`) or that it is untracked, with the
   file's size and mtime, and on
   Unix its inode's change time and number (`identity`): a file's content
   shows as its stat, as git's own index tells a change, so a rewrite
   that restores an old mtime (`cp -p`, `tar`) is seen too; off Unix, where
   the standard library gives neither, it is not (open-tasks 22). A file
   modified within the last three seconds (`RACY`, past FAT's two-second
   tick) adds, as git reads a racily clean entry, a symlink's target or a
   regular file's first MiB (`RACY_BYTES`), at most 16 MiB a check
   (`RACY_BUDGET`); a file past what is left makes the check read as
   changed, and a load decides. Only a path found to be a regular file is
   opened, so no link is followed, unless one is swapped in between the
   look and the open (`hash_file`). A rewrite to the same
   size within one tick of the file system's clock is so seen at once in
   its first MiB, and past it when the file leaves the three seconds: the
   next check then differs from the last and loads once more, as it does
   for any racy file; one dated in the future stays racy until its time
   passes. The fingerprint is the hash of the states with the snapshot;
   between two commits the snapshot alone fixes it. It is compared only within one run (`DefaultHasher` is not stable
   across Rust versions). Cost: no patch is read; git stats the tracked
   files and hashes those whose stat moved, and the app reads at most a
   MiB of each file written in the last three seconds, and 16 MiB in
   all. It runs only when nothing watches: on focus, on the 2 s poll
   (ADR 0005 §4), and at the start of each load (ADR 0023 §2).
5. **Blobs refuse paths that leave the tree**, on either side: only
   normal components (`relative`), and a working-tree path must
   canonicalize inside the root. A failed file operation reports its path
   (`failed`).
6. **The watch** covers the working tree recursively, plus the git
   directory and common directory when they lie outside it (a worktree),
   and reports a burst of events once after 250 ms of quiet
   (`watch.rs`, `SETTLE`), with the working-tree paths it touched
   (ADR 0005 §1), or everything when the working tree's index changed
   (ADR 0018 §1). Dropping the guard stops it and its thread. A branch
   no worktree has checked out watches its common directory alone
   (Decision 12). A burst whose events touched only the project's
   `OWN_FOLDER` calls nothing (`WatchedPaths::only_own`, ADR 0031 §4).
7. **Stdin is written on its own thread** (`command.rs`): git can fill
   its stdout pipe before it has read all its input.
8. **Git is found as a terminal finds it** (`locate.rs`), once per
   `GitProgram`, which the composition root holds for every `Git` and
   `GitProject` it opens: the first `git` on `PATH`; else, on Unix, the file
   `$SHELL -lc 'command -v git'` names, since an app opened from the
   macOS Finder gets a minimal `PATH`; else plain `git`, which fails with
   a message naming where it looked (`MISSING`). The developer's call,
   2026-10-13. On macOS, when the one found is `/usr/bin/git` (`LAUNCHER`),
   the `git` in its `--exec-path` is run instead, when there is one
   (`past_launcher`): the launcher looks up Xcode's on every run, about
   17 ms a call (measured 2026-10-23: 26 ms against 9 ms). Any other git is
   run as found: its exec path can be a versioned folder an upgrade
   removes (Homebrew's Cellar), while the one found is kept for the run.
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

11. **Refs and their dates come from one `for-each-ref`**, sorted
    `-creatordate` with `%(creatordate:unix)`: a commit's committer
    date, or an annotated tag's tagger date. **The uncommitted line
    count** is the lines `changes(Uncommitted)` would show: the same
    diff with `--numstat -z` (`parse::numstat`; a binary file counts
    none), and each untracked file it does not name, read as
    `untracked::added` reads it (`untracked::open`) and counted without
    keeping its text. It reads every changed and untracked file's bytes,
    as a load against the uncommitted changes does, once each time the
    base picker opens. Until 2026-10-17 refs carried behind
    counts (`%(ahead-behind:HEAD)`, git 2.41 or later) and the
    uncommitted changes were counted in files.

12. **A branch no worktree has checked out is read from its commits**
    (`Git::for_branch`, `shows::Branch`; ADR 0026 §3): `git` runs in the
    common git directory, the branch's ref (the local one, else the
    remote one) stands for `HEAD`, the new side is its commit, the
    uncommitted changes and their line counts are refused
    (`RepoError::NotCheckedOut`), its own ref is not offered as a base,
    and the watch covers the common directory alone, with no index. A
    branch a worktree has checked out opens that worktree, as
    `Git::open` does; one with no such name is `RepoError::NoBranch`.
    What differs between the two is the one place it is decided, the
    private `Shows` trait (`shows.rs`) with its `WorkingTree` and `Branch`.

13. **A project's branches come from one `for-each-ref` and
    `worktree list --porcelain`** (`GitProject`, `project.rs`), run
    in its common git directory: local branches first, each with its
    upstream folded in when that ref exists, then each remote's branch
    that is no local branch's upstream, named without its remote unless
    the name is taken (as `origin/fix`), a remote's name ending at the
    first `/` as the base picker's does (open-tasks 24); `HEAD` refs are left out, and so is a
    worktree whose folder is gone (`prunable`), while a branch a worktree
    has checked out before its first commit, which has no ref, is listed
    with no commit. Each says where it is
    (`Location`: local, with its upstream's remote and the worktree that
    has it checked out, or a remote's alone). O(refs), once each time the
    branch switcher checks the project (ADR 0035) or a review is opened. While a
    review is shown from its commits, each poll asks only which worktree
    has its branch (`Project::worktree_of`, `worktree list` alone).

## Pitfalls

- A hunk is read by its line counts, never by looking for the next
  `diff --git`: a changed line can start with that text.
- `git diff --git` headers are ambiguous for paths with spaces; only an
  identical pair is split from the header, and renames take their paths
  from `rename from` / `rename to`.

## Progress (2026-10-25, the review file)

A watch burst that touched only the project's `diff-loop/` folder, where
reviews are saved, calls nothing (`WatchedPaths::only_own`, ADR 0031 §4).

## Progress (2026-10-23, fewer git calls)

`GitProgram` looks for git once per run (Decision 8; open-tasks 26
closed), past macOS's launcher. `Git` keeps its common git directory
from opening, where one `rev-parse` also tells the root, and its watch
asks for both git paths in one call. One simulated branch switch on
this repository went from about 720 ms to about 155 ms.

## Progress (2026-10-19, reviews per branch)

Step 10 landed (ADR 0026; Decisions 1, 12 and 13).

## Progress (2026-10-17, the base picker as designed)

Step 9 landed (Decision 11 as changed); git 2.41 is no longer needed
for anything the picker shows.

## Progress (2026-10-17, file states)

ADR 0023: `file_states` gives each changed or untracked file its own
hash, and the fingerprint is theirs (Decision 4).

## Progress (2026-10-16, a cheaper fingerprint)

The fingerprint reads no patch: raw names and file stats (Decision 4),
closing open-tasks 7; until then it hashed the whole patch.

## Progress (2026-10-16, the index)

ADR 0018 §1: the watch reports everything when the index changes
(Decision 6).

## Progress (2026-10-13, the base picker's notes)

Step 8 landed.

## Progress (2026-10-13, reading only what was touched)

Step 7 landed; the watch names what it touched (ADR 0005).

## Progress (2026-10-13, git through the login shell)

Decisions 8 and 9 landed: an app without `git` on its `PATH` asks the
login shell, and gives up on one that has not exited within 5 s.

## Progress (2026-10-13, first version)

Landed with tests against real repositories in temporary directories.
