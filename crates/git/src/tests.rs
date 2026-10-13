//! The adapter against real repositories in temporary directories.

#[cfg(unix)]
use std::os::unix::fs::symlink;
use std::{fs, path::Path, process::Command, sync::mpsc, time::Duration};

use diff_loop_core::{
    Base, Content, FileDiff, Head, Line, NewSide, RefKind, RepoError, Repository, Side, Status,
};
use tempfile::TempDir;

use super::Git;

fn git(dir: &Path, args: &[&str]) {
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
        Path::new(&checkout.root).canonicalize().unwrap(),
        dir.path().canonicalize().unwrap()
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
fn the_fingerprint_changes_with_any_edit_and_only_then() {
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
        .watch(Box::new(move || {
            let _ = changed.send(());
        }))
        .unwrap();
    write(dir.path(), "src/handler.ts", "edited\n");
    assert!(seen.recv_timeout(Duration::from_secs(5)).is_ok());
    drop(guard);
    write(dir.path(), "src/handler.ts", "edited again\n");
    assert!(seen.recv_timeout(Duration::from_secs(1)).is_err());
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
        .watch(Box::new(move || {
            let _ = changed.send(());
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
