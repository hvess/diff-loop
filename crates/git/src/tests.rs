//! The adapter against real repositories in temporary directories.

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::mpsc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[cfg(unix)]
use std::{os::unix::fs::symlink, thread};

use diff_loop_core::{
    Base, Content, FileDiff, Head, Line, LineCounts, Location, NewSide, Project, RefKind,
    RepoError, Repository, Side, Status, Touched,
};
use tempfile::TempDir;

use super::{Git, GitProject};

fn git(dir: &Path, args: &[&str]) {
    git_with(dir, args, &[]);
}

/// As [`git`], with `env` set besides.
fn git_with(dir: &Path, args: &[&str], env: &[(&str, &str)]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .envs(env.iter().copied())
        .output()
        .unwrap();
    assert!(
        status.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&status.stderr)
    );
}

fn write(dir: &Path, path: &str, text: &str) {
    let full = dir.join(path);
    fs::create_dir_all(full.parent().unwrap()).unwrap();
    fs::write(full, text).unwrap();
}

/// A repository on `main` with one commit, then on branch `agent/x`.
fn repo() -> TempDir {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    git(root, &["init", "-q", "-b", "main"]);
    write(root, "src/handler.ts", "a\nb\nc\n");
    write(root, "old.txt", "keep\n");
    fs::write(root.join("logo.png"), [0u8, 1, 2, 3]).unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "init"]);
    git(root, &["switch", "-qc", "agent/x"]);
    dir
}

/// The lines a file's diff shows on the new side, as (number, text).
fn new_side(file: &FileDiff) -> Vec<(u32, &str)> {
    let Content::Text { hunks } = &file.content else {
        return Vec::new();
    };
    hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter_map(|line| match line {
            Line::Context { new, text, .. } | Line::Added { new, text } => {
                Some((*new, text.as_str()))
            }
            Line::Removed { .. } => None,
        })
        .collect()
}

fn paths(git: &Git, base: &Base) -> Vec<(String, Status)> {
    git.changes(base)
        .unwrap()
        .files
        .into_iter()
        .map(|f| (f.path, f.status))
        .collect()
}

#[test]
fn open_refuses_a_folder_outside_any_repository() {
    let dir = TempDir::new().unwrap();
    let error = Git::open(dir.path()).unwrap_err();
    assert!(
        matches!(error, RepoError::NotARepository { .. }),
        "{error:?}"
    );
}

#[test]
fn open_finds_the_root_from_a_subfolder() {
    let dir = repo();
    let git = Git::open(&dir.path().join("src")).unwrap();
    let checkout = git.checkout().unwrap();
    assert_eq!(
        Path::new(checkout.worktree.as_deref().unwrap())
            .canonicalize()
            .unwrap(),
        dir.path().canonicalize().unwrap()
    );
    assert_eq!(
        Path::new(&checkout.project).canonicalize().unwrap(),
        dir.path().join(".git").canonicalize().unwrap()
    );
    assert_eq!(
        checkout.head,
        Head::Branch {
            name: "agent/x".into()
        }
    );
    assert!(checkout.commit.is_some());
}

#[test]
fn compares_committed_staged_unstaged_and_untracked_work_with_the_base() {
    let dir = repo();
    let root = dir.path();
    write(root, "src/handler.ts", "a\nB\nc\n");
    git(root, &["commit", "-qam", "edit"]);
    git(root, &["mv", "old.txt", "new.txt"]);
    write(root, "src/rateLimit.ts", "export {}\n");
    fs::remove_file(root.join("logo.png")).unwrap();
    let git = Git::open(root).unwrap();
    let main = Base::Ref {
        name: "main".into(),
    };
    assert_eq!(
        paths(&git, &main),
        [
            ("logo.png".into(), Status::Deleted),
            (
                "new.txt".into(),
                Status::Renamed {
                    from: "old.txt".into()
                }
            ),
            ("src/handler.ts".into(), Status::Modified),
            ("src/rateLimit.ts".into(), Status::Added),
        ]
    );
    let changes = git.changes(&main).unwrap();
    assert_eq!(
        changes.files[0].content,
        Content::Binary {
            old_size: Some(4),
            new_size: None
        }
    );
    assert_eq!(new_side(&changes.files[2]), [(1, "a"), (2, "B"), (3, "c")]);
}

#[test]
fn uncommitted_and_last_commit_bases_narrow_the_change() {
    let dir = repo();
    let root = dir.path();
    write(root, "src/handler.ts", "a\nB\nc\n");
    git(root, &["commit", "-qam", "edit"]);
    write(root, "notes.md", "draft\n");
    let git = Git::open(root).unwrap();
    assert_eq!(
        paths(&git, &Base::Uncommitted),
        [("notes.md".into(), Status::Added)]
    );
    let last = git.changes(&Base::LastCommit).unwrap();
    assert!(matches!(last.snapshot.new, NewSide::Commit { .. }));
    assert_eq!(
        last.files
            .iter()
            .map(|f| f.path.as_str())
            .collect::<Vec<_>>(),
        ["src/handler.ts"]
    );
}

#[test]
fn an_unknown_base_is_reported_by_name() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let error = git
        .changes(&Base::Ref {
            name: "nope".into(),
        })
        .unwrap_err();
    assert_eq!(
        error,
        RepoError::UnknownBase {
            name: "nope".into()
        }
    );
}

#[test]
fn a_repository_with_no_commits_shows_its_files_as_uncommitted() {
    let dir = TempDir::new().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    write(dir.path(), "a.txt", "x\n");
    let git = Git::open(dir.path()).unwrap();
    assert_eq!(
        paths(&git, &Base::Uncommitted),
        [("a.txt".into(), Status::Added)]
    );
    assert_eq!(
        git.changes(&Base::LastCommit).unwrap_err(),
        RepoError::NoCommits
    );
    assert_eq!(git.checkout().unwrap().commit, None);
}

#[test]
fn refs_list_other_branches_and_tags_but_not_the_checked_out_branch() {
    let dir = repo();
    git(dir.path(), &["tag", "v1"]);
    let refs = Git::open(dir.path()).unwrap().refs().unwrap();
    let refs: Vec<_> = refs.iter().map(|r| (r.name.as_str(), r.kind)).collect();
    assert_eq!(refs, [("main", RefKind::Branch), ("v1", RefKind::Tag)]);
}

#[test]
fn the_fingerprint_changes_with_an_edit_and_holds_without_one() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let base = Base::Ref {
        name: "main".into(),
    };
    let before = git.fingerprint(&base).unwrap();
    assert_eq!(git.fingerprint(&base).unwrap(), before);
    write(dir.path(), "src/handler.ts", "a\nb\nc\nd\n");
    let edited = git.fingerprint(&base).unwrap();
    assert_ne!(edited, before);
    write(dir.path(), "new.ts", "x\n");
    assert_ne!(git.fingerprint(&base).unwrap(), edited);
}

#[test]
fn the_fingerprint_sees_a_changed_file_edited_again_to_the_same_length() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    write(dir.path(), "src/handler.ts", "one\n");
    let path = dir.path().join("src/handler.ts");
    let at = |secs| {
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(UNIX_EPOCH + Duration::from_secs(secs))
            .unwrap();
    };
    at(1_000);
    let before = git.fingerprint(&Base::Uncommitted).unwrap();
    write(dir.path(), "src/handler.ts", "two\n");
    at(2_000);
    assert_ne!(git.fingerprint(&Base::Uncommitted).unwrap(), before);
}

#[test]
fn the_fingerprint_sees_a_same_size_rewrite_within_one_clock_tick() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let path = dir.path().join("src/handler.ts");
    let tick = SystemTime::now();
    let stamp = || {
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(tick)
            .unwrap();
    };
    write(dir.path(), "src/handler.ts", "one\n");
    stamp();
    let before = git.fingerprint(&Base::Uncommitted).unwrap();
    write(dir.path(), "src/handler.ts", "two\n");
    stamp();
    assert_ne!(git.fingerprint(&Base::Uncommitted).unwrap(), before);
}

#[test]
fn the_fingerprint_holds_while_a_file_just_written_is_left_alone() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    write(dir.path(), "src/handler.ts", "just written\n");
    write(dir.path(), "new.ts", "just written\n");
    let first = git.fingerprint(&Base::Uncommitted).unwrap();
    assert_eq!(git.fingerprint(&Base::Uncommitted).unwrap(), first);
}

#[test]
fn the_fingerprint_sees_an_untracked_file_rewritten_within_one_clock_tick() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let path = dir.path().join("new.ts");
    let tick = SystemTime::now();
    let stamp = || {
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(tick)
            .unwrap();
    };
    write(dir.path(), "new.ts", "one\n");
    stamp();
    let before = git.fingerprint(&Base::Uncommitted).unwrap();
    write(dir.path(), "new.ts", "two\n");
    stamp();
    assert_ne!(git.fingerprint(&Base::Uncommitted).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn the_fingerprint_sees_an_old_modification_time_restored() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let path = dir.path().join("src/handler.ts");
    let restore = || {
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(UNIX_EPOCH + Duration::from_secs(1_000))
            .unwrap();
    };
    write(dir.path(), "src/handler.ts", "one\n");
    restore();
    let before = git.fingerprint(&Base::Uncommitted).unwrap();
    // As `cp -p` does: the old time back, the inode's change time moved,
    // past a whole second for a file system that keeps no finer time.
    thread::sleep(Duration::from_millis(1_100));
    write(dir.path(), "src/handler.ts", "two\n");
    restore();
    assert_ne!(git.fingerprint(&Base::Uncommitted).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn the_fingerprint_follows_no_racy_link_even_to_a_pipe() {
    let dir = repo();
    let fifo = dir.path().join("pipe");
    assert!(
        Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success()
    );
    symlink(&fifo, dir.path().join("link")).unwrap();
    let git = Git::open(dir.path()).unwrap();
    let (done, finished) = mpsc::channel();
    // Opening the pipe through the link would block until a writer came.
    thread::spawn(move || {
        let _ = done.send(git.fingerprint(&Base::Uncommitted).is_ok());
    });
    assert_eq!(finished.recv_timeout(Duration::from_secs(5)), Ok(true));
}

#[test]
fn an_edit_changes_only_its_own_files_state() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    write(dir.path(), "src/handler.ts", "one\n");
    write(dir.path(), "new.ts", "x\n");
    let before = git.file_states(&Base::Uncommitted).unwrap();
    assert_eq!(
        before.files.keys().map(String::as_str).collect::<Vec<_>>(),
        ["new.ts", "src/handler.ts"]
    );
    write(dir.path(), "new.ts", "a longer line\n");
    let now = git.file_states(&Base::Uncommitted).unwrap();
    assert_eq!(
        before.touched_since(&now),
        Touched::Paths(["new.ts".to_owned()].into())
    );
    assert_eq!(
        git.fingerprint(&Base::Uncommitted).unwrap(),
        now.fingerprint()
    );
}

#[test]
fn the_fingerprint_of_the_last_commit_is_its_ids() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let before = git.fingerprint(&Base::LastCommit).unwrap();
    write(dir.path(), "src/handler.ts", "edited, not committed\n");
    assert_eq!(git.fingerprint(&Base::LastCommit).unwrap(), before);
}

#[test]
fn blobs_come_from_the_base_commit_and_the_working_tree() {
    let dir = repo();
    write(dir.path(), "src/handler.ts", "new\n");
    let git = Git::open(dir.path()).unwrap();
    let changes = git
        .changes(&Base::Ref {
            name: "main".into(),
        })
        .unwrap();
    let snapshot = &changes.snapshot;
    assert_eq!(
        git.blob(snapshot, Side::Old, "src/handler.ts").unwrap(),
        b"a\nb\nc\n"
    );
    assert_eq!(
        git.blob(snapshot, Side::New, "src/handler.ts").unwrap(),
        b"new\n"
    );
    for side in [Side::Old, Side::New] {
        for path in ["../secret", "/etc/passwd", "src/../../x"] {
            assert!(matches!(
                git.blob(snapshot, side, path),
                Err(RepoError::OutsideRepository { .. })
            ));
        }
    }
}

#[test]
fn commits_between_counts_forward_and_detects_rewrites() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let first = git.checkout().unwrap().commit.unwrap();
    write(dir.path(), "a.txt", "1\n");
    self::git(dir.path(), &["add", "."]);
    self::git(dir.path(), &["commit", "-qm", "one"]);
    let second = git.checkout().unwrap().commit.unwrap();
    assert_eq!(git.commits_between(&first, &second).unwrap(), Some(1));
    assert_eq!(git.commits_between(&second, &first).unwrap(), None);
}

#[test]
fn commits_between_refuses_an_option_for_a_commit() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let head = git.checkout().unwrap().commit.unwrap();
    assert!(git.commits_between("--all", &head).unwrap().is_none());
}

#[test]
fn a_worktree_is_named_after_its_main_repository() {
    let dir = repo();
    let main_name = dir
        .path()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let worktree = TempDir::new().unwrap();
    let at = worktree.path().join("wt");
    git(
        dir.path(),
        &[
            "worktree",
            "add",
            "-q",
            at.to_str().unwrap(),
            "-b",
            "agent/y",
        ],
    );
    let checkout = Git::open(&at).unwrap().checkout().unwrap();
    assert_eq!(checkout.name, main_name);
    assert_eq!(
        checkout.head,
        Head::Branch {
            name: "agent/y".into()
        }
    );
}

#[test]
fn a_file_removed_from_the_index_but_still_on_disk_is_listed_once() {
    let dir = repo();
    git(dir.path(), &["rm", "-q", "--cached", "old.txt"]);
    let git = Git::open(dir.path()).unwrap();
    let files = git.changes(&Base::Uncommitted).unwrap().files;
    let old: Vec<_> = files
        .iter()
        .filter(|f| f.path == "old.txt")
        .map(|f| &f.status)
        .collect();
    assert_eq!(old, [&Status::Deleted]);
}

#[test]
fn untracked_binary_and_empty_files_are_additions() {
    let dir = repo();
    fs::write(dir.path().join("pic.bin"), [1u8, 0, 2]).unwrap();
    fs::write(dir.path().join("empty.txt"), "").unwrap();
    let git = Git::open(dir.path()).unwrap();
    let files = git.changes(&Base::Uncommitted).unwrap().files;
    assert_eq!(files[0].content, Content::Text { hunks: vec![] });
    assert_eq!(
        files[1].content,
        Content::Binary {
            old_size: None,
            new_size: Some(3)
        }
    );
}

#[test]
fn a_watch_reports_an_edit_and_stops_when_dropped() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let (changed, seen) = mpsc::channel();
    let guard = git
        .watch(Box::new(move |touched| {
            let _ = changed.send(touched);
        }))
        .unwrap();
    write(dir.path(), "src/handler.ts", "edited\n");
    let touched = seen.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(
        touched,
        Touched::Paths(["src/handler.ts".to_owned()].into())
    );
    drop(guard);
    write(dir.path(), "src/handler.ts", "edited again\n");
    assert!(seen.recv_timeout(Duration::from_secs(1)).is_err());
}

#[test]
fn a_change_to_the_index_alone_touches_everything_but_a_read_does_not() {
    let dir = repo();
    let git_repo = Git::open(dir.path()).unwrap();
    let (changed, seen) = mpsc::channel();
    let _guard = git_repo
        .watch(Box::new(move |touched| {
            let _ = changed.send(touched);
        }))
        .unwrap();
    // The app's own reads never write the index.
    git_repo.changes(&Base::Uncommitted).unwrap();
    assert!(
        seen.recv_timeout(Duration::from_secs(1))
            .map_or(true, |t| t != Touched::Everything)
    );
    git(dir.path(), &["rm", "-q", "--cached", "src/handler.ts"]);
    let everything = (0..10).any(|_| {
        seen.recv_timeout(Duration::from_secs(5))
            .is_ok_and(|t| t == Touched::Everything)
    });
    assert!(everything);
}

#[test]
fn a_worktree_watch_sees_a_commit() {
    let dir = repo();
    let worktree = TempDir::new().unwrap();
    let at = worktree.path().join("wt");
    git(
        dir.path(),
        &[
            "worktree",
            "add",
            "-q",
            at.to_str().unwrap(),
            "-b",
            "agent/y",
        ],
    );
    let watched = Git::open(&at).unwrap();
    let (changed, seen) = mpsc::channel();
    let _guard = watched
        .watch(Box::new(move |touched| {
            let _ = changed.send(touched);
        }))
        .unwrap();
    // Commit from the main checkout: only the shared git directory changes.
    write(dir.path(), "late.txt", "x\n");
    git(dir.path(), &["add", "late.txt"]);
    git(dir.path(), &["commit", "-qm", "late"]);
    assert!(seen.recv_timeout(Duration::from_secs(5)).is_ok());
}

#[cfg(unix)]
#[test]
fn a_blob_through_a_symlinked_directory_out_of_the_tree_is_refused() {
    let dir = repo();
    let elsewhere = TempDir::new().unwrap();
    fs::write(elsewhere.path().join("secret"), "x").unwrap();
    symlink(elsewhere.path(), dir.path().join("link")).unwrap();
    let git = Git::open(dir.path()).unwrap();
    let snapshot = git.changes(&Base::Uncommitted).unwrap().snapshot;
    assert!(matches!(
        git.blob(&snapshot, Side::New, "link/secret"),
        Err(RepoError::OutsideRepository { .. })
    ));
}

#[test]
fn a_failed_read_names_the_file() {
    let dir = repo();
    let git = Git::open(dir.path()).unwrap();
    let snapshot = git.changes(&Base::Uncommitted).unwrap().snapshot;
    let Err(RepoError::Failed { message }) = git.blob(&snapshot, Side::New, "gone.txt") else {
        panic!("a missing file fails");
    };
    assert!(message.contains("gone.txt"), "{message}");
}

fn set(paths: &[&str]) -> BTreeSet<String> {
    paths.iter().map(|p| (*p).to_owned()).collect()
}

fn names(files: &[FileDiff]) -> Vec<&str> {
    files.iter().map(|f| f.path.as_str()).collect()
}

#[test]
fn changes_in_reads_only_the_paths_given_tracked_and_untracked() {
    let dir = repo();
    write(dir.path(), "src/handler.ts", "a\nB\nc\n");
    write(dir.path(), "old.txt", "changed\n");
    write(dir.path(), "src/new/one.ts", "1\n");
    write(dir.path(), "notes.md", "n\n");
    let git = Git::open(dir.path()).unwrap();
    let base = Base::Uncommitted;
    let some = git.changes_in(&base, &set(&["src"])).unwrap();
    assert_eq!(names(&some.files), ["src/handler.ts", "src/new/one.ts"]);
    let all = git.changes(&base).unwrap();
    assert_eq!(some.snapshot, all.snapshot);
    let picked: Vec<&FileDiff> = all
        .files
        .iter()
        .filter(|f| f.path.starts_with("src/"))
        .collect();
    assert_eq!(some.files.iter().collect::<Vec<_>>(), picked);
}

#[test]
fn changes_in_no_paths_reads_no_files() {
    let dir = repo();
    write(dir.path(), "old.txt", "changed\n");
    let git = Git::open(dir.path()).unwrap();
    let none = git
        .changes_in(&Base::Uncommitted, &BTreeSet::new())
        .unwrap();
    assert!(none.files.is_empty());
    assert_eq!(
        none.snapshot,
        git.changes(&Base::Uncommitted).unwrap().snapshot
    );
}

#[test]
fn changes_in_finds_a_rename_given_both_paths() {
    let dir = repo();
    git(dir.path(), &["mv", "old.txt", "moved.txt"]);
    let git_ = Git::open(dir.path()).unwrap();
    let both = git_
        .changes_in(&Base::Uncommitted, &set(&["moved.txt", "old.txt"]))
        .unwrap();
    assert_eq!(names(&both.files), ["moved.txt"]);
    assert_eq!(
        both.files[0].status,
        Status::Renamed {
            from: "old.txt".into()
        }
    );
}

#[cfg(unix)]
#[test]
fn changes_in_reads_a_path_literally() {
    let dir = repo();
    write(dir.path(), "*.ts", "glob-looking\n");
    write(dir.path(), "x.ts", "x\n");
    let git = Git::open(dir.path()).unwrap();
    let only = git.changes_in(&Base::Uncommitted, &set(&["*.ts"])).unwrap();
    assert_eq!(names(&only.files), ["*.ts"]);
}

/// Commits on the current branch with `seconds` since the epoch as its
/// committer date.
fn commit_at(dir: &Path, seconds: u64, message: &str) {
    let date = format!("@{seconds} +0000");
    git_with(
        dir,
        &["commit", "-q", "--allow-empty", "-m", message],
        &[("GIT_COMMITTER_DATE", &date)],
    );
}

#[test]
fn refs_come_most_recently_updated_first_with_their_dates() {
    let dir = repo();
    let root = dir.path();
    git(root, &["switch", "-q", "main"]);
    commit_at(root, 1_700_000_000, "older");
    git(root, &["switch", "-qc", "newer"]);
    commit_at(root, 1_800_000_000, "newer");
    git(root, &["switch", "-q", "agent/x"]);
    let refs = Git::open(root).unwrap().refs().unwrap();
    let listed: Vec<_> = refs.iter().map(|r| (r.name.as_str(), r.updated)).collect();
    assert_eq!(
        listed,
        [
            ("newer", Some(1_800_000_000_000)),
            ("main", Some(1_700_000_000_000))
        ]
    );
}

#[test]
fn refs_before_the_first_commit_are_listed() {
    let source = repo();
    let dir = TempDir::new().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    let from = source.path().to_str().unwrap();
    git(dir.path(), &["fetch", "-q", from, "main:refs/heads/other"]);
    let refs = Git::open(dir.path()).unwrap().refs().unwrap();
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].name, "other");
    assert!(refs[0].updated.is_some());
}

/// The lines `changes(Uncommitted)` shows, counted as `uncommitted_lines` counts them.
fn shown_lines(git: &Git) -> LineCounts {
    let changes = git.changes(&Base::Uncommitted).unwrap();
    changes
        .files
        .iter()
        .filter_map(|file| match &file.content {
            Content::Text { hunks } => Some(hunks),
            Content::Binary { .. } => None,
        })
        .flatten()
        .flat_map(|hunk| &hunk.lines)
        .fold(LineCounts::default(), |sum, line| match line {
            Line::Added { .. } => LineCounts {
                added: sum.added + 1,
                ..sum
            },
            Line::Removed { .. } => LineCounts {
                removed: sum.removed + 1,
                ..sum
            },
            Line::Context { .. } => sum,
        })
}

#[test]
fn uncommitted_lines_count_tracked_and_untracked_changes() {
    let dir = repo();
    let git_ = Git::open(dir.path()).unwrap();
    assert_eq!(git_.uncommitted_lines().unwrap(), LineCounts::default());
    write(dir.path(), "src/handler.ts", "a\nB\nc\nd\n");
    write(dir.path(), "new/a.ts", "1\n2\n");
    write(dir.path(), "new/no-newline.ts", "x");
    fs::write(dir.path().join("new/blob.bin"), [0u8, 9, 9]).unwrap();
    fs::write(dir.path().join("logo.png"), [0u8, 4]).unwrap();
    git(dir.path(), &["mv", "old.txt", "moved.txt"]);
    write(dir.path(), "moved.txt", "keep\nmore\n");
    let counts = git_.uncommitted_lines().unwrap();
    // handler.ts +2 −1, a.ts +2, no-newline.ts +1, moved.txt +1; binaries none.
    assert_eq!(
        counts,
        LineCounts {
            added: 6,
            removed: 1
        }
    );
    assert_eq!(counts, shown_lines(&git_));
}

/// A file removed from the index but still on disk counts as the deletion
/// the list shows, and a staged change undone on disk not at all.
#[test]
fn uncommitted_lines_match_what_uncommitted_changes_show() {
    let dir = repo();
    git(dir.path(), &["rm", "-q", "--cached", "old.txt"]);
    write(dir.path(), "src/handler.ts", "staged\n");
    git(dir.path(), &["add", "src/handler.ts"]);
    write(dir.path(), "src/handler.ts", "a\nb\nc\n");
    let git_ = Git::open(dir.path()).unwrap();
    let counts = git_.uncommitted_lines().unwrap();
    assert_eq!(counts, shown_lines(&git_));
    assert_eq!(
        counts,
        LineCounts {
            added: 0,
            removed: 1
        }
    );
}

/// Counted in pieces, a file past the binary probe, with and without a last
/// newline, and a symlink count as the list shows them.
#[test]
fn uncommitted_lines_count_long_files_and_links_as_shown() {
    let dir = repo();
    write(dir.path(), "long.txt", &"line\n".repeat(5000));
    write(
        dir.path(),
        "open.txt",
        &format!("{}tail", "x\n".repeat(9000)),
    );
    #[cfg(unix)]
    symlink("src/handler.ts", dir.path().join("link")).unwrap();
    let git_ = Git::open(dir.path()).unwrap();
    let counts = git_.uncommitted_lines().unwrap();
    assert_eq!(counts, shown_lines(&git_));
    let link = if cfg!(unix) { 1 } else { 0 };
    assert_eq!(counts.added, 5000 + 9001 + link);
}

/// `repo()` with `agent/x` committed on and left, so no worktree has it
/// checked out, `main` back in the main checkout with an edit not committed;
/// and a worktree at `wt` on `agent/y`.
fn branches_apart() -> (TempDir, TempDir) {
    let dir = repo();
    write(dir.path(), "src/handler.ts", "a\nB\nc\n");
    git(dir.path(), &["commit", "-qam", "on x"]);
    git(dir.path(), &["switch", "-q", "main"]);
    write(dir.path(), "old.txt", "edited on main, not committed\n");
    let worktrees = TempDir::new().unwrap();
    let at = worktrees.path().join("wt");
    git(
        dir.path(),
        &[
            "worktree",
            "add",
            "-q",
            at.to_str().unwrap(),
            "-b",
            "agent/y",
        ],
    );
    (dir, worktrees)
}

fn project_of(dir: &TempDir) -> PathBuf {
    dir.path().join(".git")
}

#[test]
fn a_branch_checked_out_in_a_worktree_opens_there() {
    let (dir, worktrees) = branches_apart();
    let git = Git::for_branch(&project_of(&dir), "agent/y").unwrap();
    let checkout = git.checkout().unwrap();
    assert_eq!(
        Path::new(checkout.worktree.as_deref().unwrap())
            .canonicalize()
            .unwrap(),
        worktrees.path().join("wt").canonicalize().unwrap()
    );
    assert_eq!(
        Path::new(&checkout.project).canonicalize().unwrap(),
        project_of(&dir).canonicalize().unwrap(),
        "a worktree shares its repository's project"
    );
}

#[test]
fn a_branch_no_worktree_has_shows_only_its_commits() {
    let (dir, _worktrees) = branches_apart();
    let git = Git::for_branch(&project_of(&dir), "agent/x").unwrap();
    let checkout = git.checkout().unwrap();
    assert_eq!(checkout.worktree, None);
    assert_eq!(
        checkout.head,
        Head::Branch {
            name: "agent/x".into()
        }
    );
    let main = Base::Ref {
        name: "main".into(),
    };
    let changes = git.changes(&main).unwrap();
    // Its commit, not main's uncommitted edit to old.txt.
    assert_eq!(names(&changes.files), ["src/handler.ts"]);
    assert_eq!(
        changes.snapshot.new,
        NewSide::Commit {
            id: checkout.commit.clone().unwrap()
        }
    );
    let last = git.changes(&Base::LastCommit).unwrap();
    assert_eq!(names(&last.files), ["src/handler.ts"]);
    let blob = git
        .blob(&changes.snapshot, Side::New, "src/handler.ts")
        .unwrap();
    assert_eq!(blob, b"a\nB\nc\n");
    let refused = RepoError::NotCheckedOut {
        branch: "agent/x".into(),
    };
    assert_eq!(git.changes(&Base::Uncommitted).unwrap_err(), refused);
    assert_eq!(git.uncommitted_lines().unwrap_err(), refused);
    assert!(git.file_states(&main).unwrap().files.is_empty());
    let refs: Vec<String> = git.refs().unwrap().into_iter().map(|r| r.name).collect();
    assert!(refs.contains(&"main".to_owned()));
    assert!(!refs.contains(&"agent/x".to_owned()), "the branch shown");
}

#[test]
fn a_branch_that_does_not_exist_is_named_as_such() {
    let (dir, _worktrees) = branches_apart();
    assert_eq!(
        Git::for_branch(&project_of(&dir), "agent/gone").unwrap_err(),
        RepoError::NoBranch {
            name: "agent/gone".into()
        }
    );
}

#[test]
fn a_project_lists_its_branches_with_where_each_is_checked_out() {
    let (dir, worktrees) = branches_apart();
    let project = GitProject::open(&project_of(&dir)).unwrap();
    let branches = project.branches().unwrap();
    let at = |name: &str| {
        let branch = branches.iter().find(|b| b.name == name).unwrap();
        branch
            .worktree()
            .map(|w| Path::new(w).canonicalize().unwrap())
    };
    assert_eq!(at("main"), Some(dir.path().canonicalize().unwrap()));
    assert_eq!(
        at("agent/y"),
        Some(worktrees.path().join("wt").canonicalize().unwrap())
    );
    assert_eq!(at("agent/x"), None);
    let worktree = project.worktree_of("agent/y").unwrap();
    assert_eq!(
        worktree.map(|w| Path::new(&w).canonicalize().unwrap()),
        at("agent/y")
    );
    assert_eq!(project.worktree_of("agent/x").unwrap(), None);
    assert!(
        branches
            .iter()
            .all(|b| matches!(b.location, Location::Local { remote: None, .. }))
    );
}

#[test]
fn a_clone_lists_a_remote_branch_without_its_remote_and_opens_it_from_its_commits() {
    let (origin, _worktrees) = branches_apart();
    let clones = TempDir::new().unwrap();
    let clone = clones.path().join("clone");
    git(
        clones.path(),
        &[
            "clone",
            "-q",
            origin.path().to_str().unwrap(),
            clone.to_str().unwrap(),
        ],
    );
    let project = GitProject::open(&clone.join(".git")).unwrap();
    let branches = project.branches().unwrap();
    let main = branches.iter().find(|b| b.name == "main").unwrap();
    assert!(
        matches!(&main.location, Location::Local { remote: Some(r), .. } if r == "origin"),
        "its upstream folded in"
    );
    let x = branches.iter().find(|b| b.name == "agent/x").unwrap();
    assert!(matches!(&x.location, Location::Remote { remote } if remote == "origin"));
    assert!(!branches.iter().any(|b| b.name.ends_with("HEAD")));
    let git = Git::for_branch(&clone.join(".git"), "agent/x").unwrap();
    let checkout = git.checkout().unwrap();
    assert_eq!(checkout.worktree, None);
    assert_eq!(checkout.commit, x.commit);
}

/// Regression: a branch with no commit yet had no ref, so the switcher took it for deleted.
#[test]
fn a_branch_with_no_commit_yet_is_listed_where_it_is_checked_out() {
    let dir = TempDir::new().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    write(dir.path(), "a.txt", "a\n");
    let project = GitProject::open(&project_of(&dir)).unwrap();
    let branches = project.branches().unwrap();
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].name, "main");
    assert_eq!(branches[0].commit, None);
    assert_eq!(
        branches[0]
            .worktree()
            .map(|w| Path::new(w).canonicalize().unwrap()),
        Some(dir.path().canonicalize().unwrap())
    );
}

/// Regression: a tag of the branch's name made its review `heads/fix`, a branch no project lists.
#[test]
fn a_branch_is_named_as_the_project_lists_it_when_a_tag_has_its_name() {
    let dir = repo();
    git(dir.path(), &["tag", "agent/x"]);
    let git = Git::open(dir.path()).unwrap();
    assert!(matches!(
        git.checkout().unwrap().head,
        Head::Branch { name } if name == "agent/x"
    ));
    let project = GitProject::open(&project_of(&dir)).unwrap();
    assert!(
        project
            .branches()
            .unwrap()
            .iter()
            .any(|b| b.name == "agent/x")
    );
}

#[test]
fn a_project_is_refused_for_a_folder_that_is_no_git_directory() {
    let dir = repo();
    assert!(matches!(
        GitProject::open(dir.path()),
        Err(RepoError::NotARepository { .. })
    ));
}

#[test]
fn a_watch_on_a_branch_no_worktree_has_sees_it_move() {
    let (dir, _worktrees) = branches_apart();
    let git_x = Git::for_branch(&project_of(&dir), "agent/x").unwrap();
    let (changed, seen) = mpsc::channel();
    let _guard = git_x
        .watch(Box::new(move |touched| {
            let _ = changed.send(touched);
        }))
        .unwrap();
    git(dir.path(), &["branch", "-qf", "agent/x", "main"]);
    assert!(seen.recv_timeout(Duration::from_secs(5)).is_ok());
}
