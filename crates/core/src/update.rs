//! Bringing a checkout's changes up to date by reading only what was
//! touched, and what a rename there may pair with.

use std::collections::{BTreeSet, HashMap};

use crate::{
    base::Base,
    diff::{FileDiff, Status},
    repository::{Changes, RepoError, Repository, Touched},
};

/// Past this many touched paths, they are read by their top-level
/// directories, and past this many of those, everything is read: each is a
/// git argument. A build writing thousands of ignored files then costs one
/// argument for its output directory.
const MOST_PATHS: usize = 500;

/// Changes brought up to date, and which files were read again.
#[derive(Debug)]
pub(crate) struct Updated {
    pub(crate) changes: Changes,
    /// What was read again: files at or under these paths ([`covers`]), or
    /// every file when `None`.
    pub(crate) reread: Option<BTreeSet<String>>,
}

/// `previous`, the changes against `base`, with every touched path read
/// again, and with them the other halves of a rename they newly show
/// (`with_other_halves`); everything is read again when the snapshot moved, or
/// `touched`, or it with those halves, names too much.
///
/// # Errors
/// As [`Repository::changes`].
pub(crate) fn update(
    repository: &(impl Repository + ?Sized),
    base: &Base,
    previous: Changes,
    touched: Touched,
) -> Result<Updated, RepoError> {
    let everything = || {
        Ok(Updated {
            changes: repository.changes(base)?,
            reread: None,
        })
    };
    let Touched::Paths(mut paths) = touched else {
        return everything();
    };
    if paths.len() > MOST_PATHS {
        paths = paths
            .iter()
            .map(|path| path.split('/').next().unwrap_or(path).to_owned())
            .collect();
        if paths.len() > MOST_PATHS {
            return everything();
        }
    }
    // A rename's two paths are read together, or it splits in two.
    let partners: Vec<String> = previous
        .files
        .iter()
        .filter_map(|file| match &file.status {
            Status::Renamed { from } if covers(&paths, &file.path) || covers(&paths, from) => {
                Some([file.path.clone(), from.clone()])
            }
            _ => None,
        })
        .flatten()
        .collect();
    paths.extend(partners);
    let fresh = repository.changes_in(base, &paths)?;
    if fresh.snapshot != previous.snapshot {
        return everything();
    }
    let Some(fresh) = with_other_halves(repository, base, &previous, fresh, &mut paths)? else {
        return everything();
    };
    let mut files: Vec<FileDiff> = previous
        .files
        .into_iter()
        .filter(|file| !covers(&paths, &file.path) && !covers(&paths, file.old_path()))
        .chain(fresh.files)
        .collect();
    files.sort_unstable_by(|a, b| a.path.cmp(&b.path));
    Ok(Updated {
        changes: Changes {
            snapshot: fresh.snapshot,
            files,
        },
        reread: Some(paths),
    })
}

/// `fresh` read again with the other halves of a rename it newly shows
/// (`halves`): git pairs a staged addition and a deletion only when it
/// reads them together, and the watch may have touched one (ADR 0018 §2).
/// `None` when they would pass `MOST_PATHS` in all, or the snapshot moved:
/// everything is read.
fn with_other_halves(
    repository: &(impl Repository + ?Sized),
    base: &Base,
    previous: &Changes,
    fresh: Changes,
    paths: &mut BTreeSet<String>,
) -> Result<Option<Changes>, RepoError> {
    let others = halves(&previous.files, &fresh.files, paths);
    if others.is_empty() {
        return Ok(Some(fresh));
    }
    if paths.len() + others.len() > MOST_PATHS {
        return Ok(None);
    }
    paths.extend(others);
    let again = repository.changes_in(base, paths)?;
    Ok((again.snapshot == previous.snapshot).then_some(again))
}

/// The paths in `previous`, not under `paths`, that could be the other half
/// of a rename `fresh` newly shows: its additions when a file is newly
/// deleted, its deletions when one is newly added. A file added or deleted
/// before, saved again, asks for nothing. O(p · d · log t + f) for p
/// previous and f fresh files, d a path's depth and t touched paths
/// (`covers`).
fn halves(previous: &[FileDiff], fresh: &[FileDiff], paths: &BTreeSet<String>) -> BTreeSet<String> {
    let before: HashMap<&str, &Status> = previous
        .iter()
        .map(|f| (f.path.as_str(), &f.status))
        .collect();
    let newly = |status: Status| {
        fresh
            .iter()
            .any(|f| f.status == status && before.get(f.path.as_str()) != Some(&&f.status))
    };
    let adds = newly(Status::Added);
    let deletes = newly(Status::Deleted);
    previous
        .iter()
        .filter(|f| match f.status {
            Status::Added => deletes,
            Status::Deleted => adds,
            Status::Modified | Status::Renamed { .. } => false,
        })
        .filter(|f| !covers(paths, &f.path))
        .map(|f| f.path.clone())
        .collect()
}

/// Whether `path` or a directory holding it is in `paths`; O(depth · log n).
pub(crate) fn covers(paths: &BTreeSet<String>, path: &str) -> bool {
    paths.contains(path)
        || path
            .match_indices('/')
            .any(|(slash, _)| paths.contains(&path[..slash]))
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::{
        base::BaseRef,
        diff::{
            Content, Side,
            tests::{add, text_file},
        },
        repository::{Checkout, NewSide, OnChange, Snapshot, WatchGuard},
    };

    /// A checkout whose every file is `files`; records which reads were made.
    struct Scripted {
        snapshot: Snapshot,
        files: Vec<FileDiff>,
        reads: RefCell<Vec<Option<BTreeSet<String>>>>,
    }

    impl Repository for Scripted {
        fn checkout(&self) -> Result<Checkout, RepoError> {
            unreachable!("update reads no checkout")
        }
        fn refs(&self) -> Result<Vec<BaseRef>, RepoError> {
            unreachable!("update reads no refs")
        }
        fn remote_default(&self) -> Result<Option<String>, RepoError> {
            unreachable!("update reads no remote")
        }
        fn changes(&self, _: &Base) -> Result<Changes, RepoError> {
            self.reads.borrow_mut().push(None);
            Ok(Changes {
                snapshot: self.snapshot.clone(),
                files: self.files.clone(),
            })
        }
        /// As git reads them: a rename with only one of its paths named is
        /// that half, an addition or a deletion.
        fn changes_in(&self, _: &Base, paths: &BTreeSet<String>) -> Result<Changes, RepoError> {
            self.reads.borrow_mut().push(Some(paths.clone()));
            let files = self
                .files
                .iter()
                .filter_map(
                    |f| match (covers(paths, &f.path), covers(paths, f.old_path())) {
                        (true, true) => Some(f.clone()),
                        (true, false) => Some(FileDiff {
                            status: Status::Added,
                            ..f.clone()
                        }),
                        (false, true) => Some(FileDiff {
                            status: Status::Deleted,
                            path: f.old_path().to_owned(),
                            ..f.clone()
                        }),
                        (false, false) => None,
                    },
                )
                .collect();
            Ok(Changes {
                snapshot: self.snapshot.clone(),
                files,
            })
        }
        fn fingerprint(&self, _: &Base) -> Result<String, RepoError> {
            unreachable!("update takes no fingerprint")
        }
        fn blob(&self, _: &Snapshot, _: Side, _: &str) -> Result<Vec<u8>, RepoError> {
            unreachable!("update reads no blob")
        }
        fn commits_between(&self, _: &str, _: &str) -> Result<Option<u32>, RepoError> {
            unreachable!("update counts no commits")
        }
        fn uncommitted_files(&self) -> Result<u32, RepoError> {
            unreachable!("update counts no files")
        }
        fn watch(&self, _: OnChange) -> Result<WatchGuard, RepoError> {
            unreachable!("update starts no watch")
        }
    }

    fn snapshot(old: &str) -> Snapshot {
        Snapshot {
            old: Some(old.into()),
            new: NewSide::WorkingTree,
        }
    }

    fn now(files: Vec<FileDiff>) -> Scripted {
        Scripted {
            snapshot: snapshot("a"),
            files,
            reads: RefCell::new(Vec::new()),
        }
    }

    fn changes(files: Vec<FileDiff>) -> Changes {
        Changes {
            snapshot: snapshot("a"),
            files,
        }
    }

    fn paths(list: &[&str]) -> Touched {
        Touched::Paths(list.iter().map(|p| (*p).to_owned()).collect())
    }

    fn file(path: &str, text: &str) -> FileDiff {
        text_file(path, vec![add(1, text)])
    }

    fn renamed(from: &str, to: &str) -> FileDiff {
        FileDiff {
            status: Status::Renamed { from: from.into() },
            ..text_file(to, vec![])
        }
    }

    fn names(changes: &Changes) -> Vec<&str> {
        changes.files.iter().map(|f| f.path.as_str()).collect()
    }

    #[test]
    fn only_touched_paths_are_read_again() {
        let repo = now(vec![
            file("a.ts", "new"),
            file("b.ts", "b"),
            file("c.ts", "c"),
        ]);
        let before = changes(vec![file("a.ts", "old"), file("b.ts", "b")]);
        let after = update(&repo, &Base::Uncommitted, before, paths(&["a.ts", "c.ts"]))
            .unwrap()
            .changes;
        assert_eq!(after.files, repo.files);
        assert_eq!(
            *repo.reads.borrow(),
            [Some(["a.ts".into(), "c.ts".into()].into())]
        );
    }

    #[test]
    fn a_touched_file_that_no_longer_differs_leaves_the_review() {
        let repo = now(vec![file("b.ts", "b")]);
        let before = changes(vec![file("a.ts", "a"), file("b.ts", "b")]);
        let after = update(&repo, &Base::Uncommitted, before, paths(&["a.ts"]))
            .unwrap()
            .changes;
        assert_eq!(names(&after), ["b.ts"]);
    }

    #[test]
    fn a_touched_directory_covers_the_files_under_it() {
        let repo = now(vec![file("src/x/new.ts", "n"), file("srcs.ts", "s")]);
        let before = changes(vec![file("src/x/old.ts", "o"), file("srcs.ts", "s")]);
        let after = update(&repo, &Base::Uncommitted, before, paths(&["src"]))
            .unwrap()
            .changes;
        assert_eq!(names(&after), ["src/x/new.ts", "srcs.ts"]);
    }

    #[test]
    fn a_rename_is_read_again_by_both_its_paths() {
        let repo = now(vec![renamed("old.ts", "new.ts")]);
        let before = changes(vec![renamed("old.ts", "new.ts")]);
        update(&repo, &Base::Uncommitted, before, paths(&["new.ts"])).unwrap();
        assert_eq!(
            *repo.reads.borrow(),
            [Some(["new.ts".into(), "old.ts".into()].into())]
        );
    }

    fn with_status(path: &str, status: Status) -> FileDiff {
        FileDiff {
            status,
            ..text_file(path, vec![])
        }
    }

    #[test]
    fn a_deletion_is_read_with_an_addition_the_watch_did_not_touch_and_pairs_as_a_rename() {
        // `new.ts` was staged earlier; the agent then deleted `old.ts`.
        let repo = now(vec![renamed("old.ts", "new.ts")]);
        let before = changes(vec![with_status("new.ts", Status::Added)]);
        let updated = update(&repo, &Base::Uncommitted, before, paths(&["old.ts"])).unwrap();
        assert_eq!(updated.changes.files, [renamed("old.ts", "new.ts")]);
        assert_eq!(
            *repo.reads.borrow(),
            [
                Some(["old.ts".into()].into()),
                Some(["new.ts".into(), "old.ts".into()].into())
            ]
        );
    }

    #[test]
    fn an_addition_is_read_with_a_deletion_the_watch_did_not_touch() {
        let repo = now(vec![renamed("old.ts", "new.ts")]);
        let before = changes(vec![with_status("old.ts", Status::Deleted)]);
        let updated = update(&repo, &Base::Uncommitted, before, paths(&["new.ts"])).unwrap();
        assert_eq!(updated.changes.files, [renamed("old.ts", "new.ts")]);
    }

    #[test]
    fn an_addition_saved_again_reads_nothing_more() {
        let repo = now(vec![
            with_status("new.ts", Status::Added),
            with_status("old.ts", Status::Deleted),
        ]);
        let before = changes(vec![
            with_status("new.ts", Status::Added),
            with_status("old.ts", Status::Deleted),
        ]);
        update(&repo, &Base::Uncommitted, before, paths(&["new.ts"])).unwrap();
        assert_eq!(*repo.reads.borrow(), [Some(["new.ts".into()].into())]);
    }

    #[test]
    fn too_many_other_halves_read_everything() {
        let held: Vec<FileDiff> = (0..=MOST_PATHS)
            .map(|i| with_status(&format!("new{i}.ts"), Status::Added))
            .collect();
        let mut files = held.clone();
        files.push(with_status("old.ts", Status::Deleted));
        let repo = now(files);
        let updated = update(&repo, &Base::Uncommitted, changes(held), paths(&["old.ts"])).unwrap();
        assert!(updated.reread.is_none());
    }

    #[test]
    fn an_edit_reads_nothing_more() {
        let repo = now(vec![file("a.ts", "x"), with_status("b.ts", Status::Added)]);
        let before = changes(vec![file("a.ts", "x"), with_status("b.ts", Status::Added)]);
        update(&repo, &Base::Uncommitted, before, paths(&["a.ts"])).unwrap();
        assert_eq!(*repo.reads.borrow(), [Some(["a.ts".into()].into())]);
    }

    #[test]
    fn git_state_alone_changes_nothing_while_the_snapshot_holds() {
        let repo = now(vec![file("a.ts", "changed on disk, not touched")]);
        let before = changes(vec![file("a.ts", "a")]);
        let after = update(
            &repo,
            &Base::Uncommitted,
            before.clone(),
            Touched::default(),
        )
        .unwrap()
        .changes;
        assert_eq!(after, before);
    }

    #[test]
    fn a_moved_snapshot_reads_everything() {
        let repo = now(vec![file("a.ts", "a"), file("b.ts", "b")]);
        let before = Changes {
            snapshot: snapshot("older"),
            files: vec![file("a.ts", "a")],
        };
        let after = update(&repo, &Base::Uncommitted, before, Touched::default())
            .unwrap()
            .changes;
        assert_eq!(after.files, repo.files);
        assert_eq!(repo.reads.borrow().last(), Some(&None));
    }

    #[test]
    fn too_many_or_unnamed_paths_read_everything() {
        let many: Vec<String> = (0..=MOST_PATHS).map(|i| format!("f{i}")).collect();
        let many: Vec<&str> = many.iter().map(String::as_str).collect();
        for touched in [paths(&many), Touched::Everything] {
            let repo = now(vec![file("a.ts", "a")]);
            update(&repo, &Base::Uncommitted, changes(vec![]), touched).unwrap();
            assert_eq!(*repo.reads.borrow(), [None]);
        }
    }

    #[test]
    fn what_was_read_again_is_reported() {
        let repo = now(vec![file("a.ts", "a")]);
        let some = update(&repo, &Base::Uncommitted, changes(vec![]), paths(&["a.ts"])).unwrap();
        assert_eq!(some.reread, Some(["a.ts".to_owned()].into()));
        let all = update(
            &repo,
            &Base::Uncommitted,
            changes(vec![]),
            Touched::Everything,
        )
        .unwrap();
        assert_eq!(all.reread, None);
    }

    #[test]
    fn many_paths_are_read_by_their_top_level_directories() {
        let built: Vec<String> = (0..=MOST_PATHS).map(|i| format!("target/o{i}")).collect();
        let mut touched: Vec<&str> = built.iter().map(String::as_str).collect();
        touched.push("src/a.ts");
        let repo = now(vec![file("src/a.ts", "new"), file("src/b.ts", "b")]);
        let before = changes(vec![file("src/a.ts", "old"), file("src/b.ts", "b")]);
        let after = update(&repo, &Base::Uncommitted, before, paths(&touched)).unwrap();
        assert_eq!(
            after.reread,
            Some(["src".to_owned(), "target".to_owned()].into())
        );
        assert_eq!(after.changes.files, repo.files);
    }

    #[test]
    fn a_binary_file_is_kept_like_any_other() {
        let binary = FileDiff {
            content: Content::Binary {
                old_size: None,
                new_size: Some(1),
            },
            ..file("a.png", "")
        };
        let repo = now(vec![binary.clone(), file("b.ts", "b")]);
        let before = changes(vec![binary.clone(), file("b.ts", "old")]);
        let after = update(&repo, &Base::Uncommitted, before, paths(&["b.ts"]))
            .unwrap()
            .changes;
        assert_eq!(after.files, [binary, file("b.ts", "b")]);
    }
}
