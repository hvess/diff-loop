//! Diff Loop's desktop app: the composition root and the Tauri commands the
//! front end calls.
//!
//! Each command converts, delegates to `diff_loop_core` over the open
//! [`Repository`], and converts back (quality-gate §2). [`run`] is the one
//! place an adapter is chosen.

use std::{
    fmt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

use diff_loop_core::{
    Base, BaseRef, Comment, InstructionsRequest, KnownFile, Opening, RepoError, Repository, Review,
    Side, Snapshot, WatchGuard,
};
use diff_loop_git::Git;
use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Result as TauriResult, State, async_runtime::spawn_blocking, ipc::Response,
};
use thiserror::Error;
use ts_rs::TS;

/// An open repository, shared with the blocking task that reads it.
type Shared = Arc<dyn Repository + Send + Sync>;

/// Opens the repository containing a folder.
type Opener = fn(&Path) -> Result<Shared, RepoError>;

/// The event the front end hears when the open checkout may have changed.
const CHANGED: &str = "repository-changed";

/// The checkout the window reviews, once one is open, how to open one, and
/// the watch on it.
struct Session {
    open: Opener,
    current: Mutex<Option<Shared>>,
    watch: Mutex<Option<WatchGuard>>,
}

/// The folder named on the command line, handed to the front end once.
#[derive(Debug, Default)]
struct LaunchPath(Mutex<Option<PathBuf>>);

/// Why a command failed.
#[derive(Debug, Error, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub(crate) enum CommandError {
    /// A command that needs a checkout ran before one was opened.
    #[error("no repository is open")]
    NoRepository,
    /// The repository could not answer.
    #[error("{error}")]
    Repository {
        /// Why.
        error: RepoError,
    },
    /// The work panicked; a defect in the app, not in the repository.
    #[error("{message}")]
    Internal {
        /// The runtime's description.
        message: String,
    },
}

impl From<RepoError> for CommandError {
    fn from(error: RepoError) -> Self {
        Self::Repository { error }
    }
}

impl Session {
    fn new(open: Opener) -> Self {
        Self {
            open,
            current: Mutex::new(None),
            watch: Mutex::new(None),
        }
    }

    fn current(&self) -> Result<Shared, CommandError> {
        lock(&self.current)
            .clone()
            .ok_or(CommandError::NoRepository)
    }

    /// Makes `repository` the open one; the old one's watch stops.
    fn replace(&self, repository: Shared) {
        // `current`, then `watch`, as in `keep_watch`: holding both makes the
        // swap atomic, so no guard for the old repository lands after it.
        let mut current = lock(&self.current);
        *lock(&self.watch) = None;
        *current = Some(repository);
    }

    /// Keeps `guard` running while `watched` is still the open repository,
    /// and says so; otherwise drops it, which stops it.
    fn keep_watch(&self, watched: &Shared, guard: WatchGuard) -> bool {
        let current = lock(&self.current);
        let open = current.as_ref().is_some_and(|c| Arc::ptr_eq(c, watched));
        if open {
            *lock(&self.watch) = Some(guard);
        }
        open
    }
}

impl fmt::Debug for Session {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Session")
            .field("has_repository", &lock(&self.current).is_some())
            .finish_non_exhaustive()
    }
}

/// Locks `mutex` whatever a panicking holder left: each value guarded here
/// is replaced whole, never left half-written.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Runs blocking repository work off the async runtime.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, RepoError> + Send + 'static,
) -> Result<T, CommandError> {
    Ok(spawn_blocking(work)
        .await
        .map_err(|e| CommandError::Internal {
            message: e.to_string(),
        })??)
}

/// Opens the checkout containing `path` and makes it the session's.
#[tauri::command]
async fn open_repository(
    path: PathBuf,
    session: State<'_, Session>,
) -> Result<Opening, CommandError> {
    let open = session.open;
    let (repository, opening) = blocking(move || {
        let repository = open(&path)?;
        let opening = diff_loop_core::open(&*repository)?;
        Ok((repository, opening))
    })
    .await?;
    session.replace(repository);
    Ok(opening)
}

/// Emits [`CHANGED`] whenever the open checkout may have changed, until
/// another repository is opened. `false` when another one opened first, so
/// this watch was dropped.
#[tauri::command]
async fn watch_repository(
    app: AppHandle,
    session: State<'_, Session>,
) -> Result<bool, CommandError> {
    let repository = session.current()?;
    let watched = Arc::clone(&repository);
    let guard = blocking(move || {
        repository.watch(Box::new(move || {
            // Emitting fails only while the app shuts down.
            let _ = app.emit(CHANGED, ());
        }))
    })
    .await?;
    Ok(session.keep_watch(&watched, guard))
}

/// Branches and tags the open checkout can be compared with.
#[tauri::command]
async fn refs(session: State<'_, Session>) -> Result<Vec<BaseRef>, CommandError> {
    let repository = session.current()?;
    blocking(move || repository.refs()).await
}

/// The open checkout against `base`, with `comments` moved onto their code;
/// files the front end already holds (`known`) are named, not sent.
#[tauri::command]
async fn load_review(
    base: Base,
    comments: Vec<Comment>,
    known: Vec<KnownFile>,
    session: State<'_, Session>,
) -> Result<Review, CommandError> {
    let repository = session.current()?;
    blocking(move || diff_loop_core::load(&*repository, base, comments, known)).await
}

/// A value that changes whenever [`load_review`] for `base` would.
#[tauri::command]
async fn fingerprint(base: Base, session: State<'_, Session>) -> Result<String, CommandError> {
    let repository = session.current()?;
    blocking(move || repository.fingerprint(&base)).await
}

/// How many commits `to` is ahead of `from`; `None` when history was rewritten.
#[tauri::command]
async fn commits_between(
    from: String,
    to: String,
    session: State<'_, Session>,
) -> Result<Option<u32>, CommandError> {
    let repository = session.current()?;
    blocking(move || repository.commits_between(&from, &to)).await
}

/// The raw bytes of `path` on one side of `snapshot`.
#[tauri::command]
async fn blob(
    snapshot: Snapshot,
    side: Side,
    path: String,
    session: State<'_, Session>,
) -> Result<Response, CommandError> {
    let repository = session.current()?;
    let bytes = blocking(move || repository.blob(&snapshot, side, &path)).await?;
    Ok(Response::new(bytes))
}

/// Lines `first..=last` of `path` on one side of `snapshot`: unchanged lines
/// the diff leaves out.
#[tauri::command]
async fn file_lines(
    snapshot: Snapshot,
    side: Side,
    path: String,
    first: u32,
    last: u32,
    session: State<'_, Session>,
) -> Result<Vec<String>, CommandError> {
    let repository = session.current()?;
    blocking(move || diff_loop_core::lines(&*repository, &snapshot, side, &path, first, last)).await
}

/// The folder the app was launched with (`diff-loop-app <path>`); `None` after the first call.
#[tauri::command]
fn launch_path(launch: State<'_, LaunchPath>) -> Option<PathBuf> {
    lock(&launch.0).take()
}

/// The review as instructions for a coding agent.
#[tauri::command]
fn instructions(request: InstructionsRequest) -> String {
    diff_loop_core::instructions(&request)
}

/// The adapter this app reads repositories with (ADR 0001 §4).
fn open_git(path: &Path) -> Result<Shared, RepoError> {
    Ok(Arc::new(Git::open(path)?))
}

/// Builds and runs the app until its last window closes.
///
/// # Errors
/// When the Tauri runtime cannot start: no window system, or a broken bundle.
pub fn run() -> TauriResult<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Session::new(open_git))
        .manage(LaunchPath(Mutex::new(
            std::env::args_os().nth(1).map(PathBuf::from),
        )))
        .invoke_handler(tauri::generate_handler![
            open_repository,
            refs,
            load_review,
            fingerprint,
            commits_between,
            blob,
            file_lines,
            instructions,
            launch_path,
            watch_repository,
        ])
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use std::{
        process::Command,
        sync::atomic::{AtomicBool, Ordering},
    };

    use tauri::async_runtime::block_on;
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn a_session_without_a_repository_says_so() {
        let session = Session::new(open_git);
        assert!(matches!(session.current(), Err(CommandError::NoRepository)));
    }

    #[test]
    fn open_git_refuses_a_folder_outside_any_repository() {
        let dir = TempDir::new().unwrap();
        assert!(matches!(
            open_git(dir.path()),
            Err(RepoError::NotARepository { .. })
        ));
    }

    #[test]
    fn a_session_hands_out_the_repository_it_was_given() {
        let dir = TempDir::new().unwrap();
        let init = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(["init", "-q"])
            .status();
        assert!(init.unwrap().success());
        let session = Session::new(open_git);
        session.replace((session.open)(dir.path()).unwrap());
        let checkout = session.current().unwrap().checkout().unwrap();
        assert_eq!(
            Path::new(&checkout.root).canonicalize().unwrap(),
            dir.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn blocking_passes_a_repository_error_through() {
        let error = block_on(blocking(|| -> Result<(), RepoError> {
            Err(RepoError::NoCommits)
        }));
        assert!(matches!(
            error,
            Err(CommandError::Repository {
                error: RepoError::NoCommits
            })
        ));
    }

    #[test]
    fn a_panic_in_blocking_work_is_an_internal_error() {
        let error = block_on(blocking(|| -> Result<(), RepoError> { panic!("defect") }));
        assert!(matches!(error, Err(CommandError::Internal { .. })));
    }

    /// Sets its flag when dropped, as a stopped watch would.
    struct Stops(Arc<AtomicBool>);

    impl Drop for Stops {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    fn git_repository() -> (TempDir, Shared) {
        let dir = TempDir::new().unwrap();
        let init = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(["init", "-q"])
            .status();
        assert!(init.unwrap().success());
        let repository = open_git(dir.path()).unwrap();
        (dir, repository)
    }

    #[test]
    fn opening_another_repository_stops_the_old_watch() {
        let (_dir, first) = git_repository();
        let (_other, second) = git_repository();
        let session = Session::new(open_git);
        session.replace(Arc::clone(&first));
        let stopped = Arc::new(AtomicBool::new(false));
        assert!(session.keep_watch(&first, Box::new(Stops(Arc::clone(&stopped)))));
        assert!(!stopped.load(Ordering::SeqCst));
        session.replace(second);
        assert!(stopped.load(Ordering::SeqCst));
    }

    #[test]
    fn a_watch_on_a_repository_no_longer_open_is_dropped() {
        let (_dir, first) = git_repository();
        let (_other, second) = git_repository();
        let session = Session::new(open_git);
        session.replace(second);
        let stopped = Arc::new(AtomicBool::new(false));
        assert!(!session.keep_watch(&first, Box::new(Stops(Arc::clone(&stopped)))));
        assert!(stopped.load(Ordering::SeqCst));
    }
}
