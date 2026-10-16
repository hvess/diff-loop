//! Watching a working tree and its git directories for changes.

use std::{
    iter,
    path::{Path, PathBuf},
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::Duration,
};

use diff_loop_core::{OnChange, RepoError, Touched, WatchGuard};
use notify::{
    Error as NotifyError, Event, EventKind, RecursiveMode, Watcher,
    event::{AccessKind, AccessMode, ModifyKind},
};

/// Quiet time after the last event before `on_change` runs: a checkout, a
/// commit or a build writes many files at once.
const SETTLE: Duration = Duration::from_millis(250);

/// Watches `root` and each of `git_dirs` recursively and calls `on_change`
/// once per burst of events, with the paths under `root` it touched, until
/// the returned guard is dropped. A git directory inside `root` is watched
/// with it; none of its paths are reported, but a change to `index` touches
/// everything: a change to the index alone names no working-tree path
/// (`git rm --cached`; ADR 0018 §1).
///
/// # Errors
/// [`RepoError::Failed`] when the platform refuses a watch (on Linux, the
/// inotify watch limit).
pub(crate) fn watch(
    root: &Path,
    git_dirs: &[PathBuf],
    index: &Path,
    on_change: OnChange,
) -> Result<WatchGuard, RepoError> {
    let failed = |e: NotifyError| RepoError::Failed {
        message: format!("cannot watch the repository: {e}"),
    };
    let watched = WatchedPaths {
        root: root.to_path_buf(),
        git_dirs: git_dirs.to_vec(),
        index: index.to_path_buf(),
    };
    let (events, bursts) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event: Result<Event, NotifyError>| {
        // The receiver is gone only after the guard dropped.
        let _ = events.send(watched.touched(event));
    })
    .map_err(failed)?;
    // A directory inside one already watched is left out: a worktree's git
    // directory lies inside the common one, and each watch costs inotify
    // watches (ADR 0002 §4).
    let dirs = iter::once(root.to_path_buf())
        .chain(git_dirs.iter().cloned())
        .fold(Vec::<PathBuf>::new(), |mut kept, dir| {
            if !kept.iter().any(|k| dir.starts_with(k)) {
                kept.push(dir);
            }
            kept
        });
    for path in &dirs {
        watcher
            .watch(path, RecursiveMode::Recursive)
            .map_err(failed)?;
    }
    // Ends when the guard drops the watcher, and with it the sender.
    thread::spawn(move || {
        while let Ok(first) = bursts.recv() {
            let mut touched = first;
            // Three outcomes, so not `while let`: more events extend the
            // burst, quiet ends it, a dropped guard ends the thread.
            loop {
                match bursts.recv_timeout(SETTLE) {
                    Ok(more) => touched.add(more),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            on_change(touched);
        }
    });
    Ok(Box::new(watcher))
}

/// What a watch covers, to name what an event touched.
struct WatchedPaths {
    root: PathBuf,
    git_dirs: Vec<PathBuf>,
    /// The working tree's index; the app's own git calls never write it
    /// (`GIT_OPTIONAL_LOCKS`), so its changes are someone else's.
    index: PathBuf,
}

impl WatchedPaths {
    /// The working-tree paths `event` touched. Git's own files name none,
    /// except the index, which touches everything; so do lost events and a
    /// path that is not UTF-8.
    fn touched(&self, event: Result<Event, NotifyError>) -> Touched {
        let Ok(event) = event else {
            return Touched::Everything;
        };
        if event.need_rescan() {
            return Touched::Everything;
        }
        // A directory's contents report their own edits; only its creation,
        // removal or renaming (a folder moved in brings files that report
        // nothing) names it, or each edit would read the whole directory again.
        let edited = match event.kind {
            // Reading a file changes nothing, and the app reads them itself;
            // only closing one written to does.
            EventKind::Access(AccessKind::Close(AccessMode::Write)) => true,
            EventKind::Access(_) => return Touched::default(),
            EventKind::Modify(ModifyKind::Name(_)) => false,
            EventKind::Modify(_) => true,
            _ => false,
        };
        event
            .paths
            .iter()
            .filter(|path| !(edited && path.is_dir()))
            .map(|path| self.relative(path))
            .fold(Touched::default(), |mut touched, more| {
                touched.add(more);
                touched
            })
    }

    fn relative(&self, path: &Path) -> Touched {
        if path == self.index {
            return Touched::Everything;
        }
        if self.git_dirs.iter().any(|dir| path.starts_with(dir)) {
            return Touched::default();
        }
        let Ok(inside) = path.strip_prefix(&self.root) else {
            return Touched::default();
        };
        // The root itself names no file; its contents report their own events.
        if inside.as_os_str().is_empty() {
            return Touched::default();
        }
        let parts: Option<Vec<&str>> = inside
            .components()
            .map(|c| c.as_os_str().to_str())
            .collect();
        match parts {
            Some(parts) => Touched::Paths([parts.join("/")].into()),
            None => Touched::Everything,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use notify::event::{CreateKind, Flag, RenameMode};
    use tempfile::TempDir;

    use super::*;

    fn watched() -> WatchedPaths {
        WatchedPaths {
            root: PathBuf::from("/repo"),
            git_dirs: vec![PathBuf::from("/repo/.git"), PathBuf::from("/elsewhere/wt")],
            index: PathBuf::from("/elsewhere/wt/index"),
        }
    }

    fn event(paths: &[&str]) -> Event {
        Event {
            paths: paths.iter().map(PathBuf::from).collect(),
            ..Event::new(EventKind::Any)
        }
    }

    fn paths(list: &[&str]) -> Touched {
        Touched::Paths(list.iter().map(|p| (*p).to_owned()).collect())
    }

    #[test]
    fn working_tree_paths_are_named_relative_to_the_root() {
        let touched = watched().touched(Ok(event(&["/repo/src/a.ts", "/repo/b.md"])));
        assert_eq!(touched, paths(&["b.md", "src/a.ts"]));
    }

    #[test]
    fn git_state_and_the_root_itself_name_nothing() {
        let touched = watched().touched(Ok(event(&[
            "/repo/.git/index",
            "/repo/.git/HEAD",
            "/elsewhere/wt/HEAD",
            "/elsewhere/wt/index.lock",
            "/repo",
        ])));
        assert_eq!(touched, Touched::default());
    }

    #[test]
    fn a_change_to_the_working_trees_index_touches_everything() {
        let renamed_in = Event {
            paths: vec![PathBuf::from("/elsewhere/wt/index")],
            ..Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::To)))
        };
        assert_eq!(watched().touched(Ok(renamed_in)), Touched::Everything);
    }

    #[test]
    fn reading_a_file_touches_nothing_but_closing_a_write_does() {
        let at = |kind| Event {
            paths: vec![PathBuf::from("/repo/a.ts")],
            ..Event::new(kind)
        };
        let opened = EventKind::Access(AccessKind::Open(AccessMode::Read));
        assert_eq!(watched().touched(Ok(at(opened))), Touched::default());
        let written = EventKind::Access(AccessKind::Close(AccessMode::Write));
        assert_eq!(watched().touched(Ok(at(written))), paths(&["a.ts"]));
    }

    #[test]
    fn lost_events_and_errors_touch_everything() {
        let rescan = event(&["/repo/a.ts"]).set_flag(Flag::Rescan);
        assert_eq!(watched().touched(Ok(rescan)), Touched::Everything);
        let error = NotifyError::generic("overflow");
        assert_eq!(watched().touched(Err(error)), Touched::Everything);
    }

    #[test]
    fn an_edited_directory_names_nothing_but_a_new_one_names_itself() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        let watched = WatchedPaths {
            root: dir.path().to_path_buf(),
            git_dirs: vec![dir.path().join(".git")],
            index: dir.path().join(".git/index"),
        };
        let src = dir.path().join("src");
        let at = |kind| Event {
            paths: vec![src.clone()],
            ..Event::new(kind)
        };
        assert_eq!(
            watched.touched(Ok(at(EventKind::Modify(ModifyKind::Any)))),
            Touched::default()
        );
        assert_eq!(
            watched.touched(Ok(at(EventKind::Create(CreateKind::Folder)))),
            paths(&["src"])
        );
        // A folder moved in arrives as a rename, and brings files that report nothing.
        assert_eq!(
            watched.touched(Ok(at(EventKind::Modify(ModifyKind::Name(RenameMode::To))))),
            paths(&["src"])
        );
    }
}
