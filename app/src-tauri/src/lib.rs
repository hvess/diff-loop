//! Diff Loop's desktop app: the composition root and the Tauri commands the
//! front end calls.
//!
//! Each command converts, delegates to `diff_loop_core` over the open
//! [`Repository`], and converts back (quality-gate §2). [`run`] is the one
//! place an adapter is chosen.

use std::{
    fmt, mem,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    thread,
    time::Duration,
};

#[cfg(target_os = "linux")]
mod appearance;
#[cfg(target_os = "linux")]
mod renderer;
mod reviews;

use diff_loop_core::{
    Base, BaseRef, Comment, Content, InstructionsRequest, KnownFile, Loaded, Opening, RepoError,
    Repository, Review, ReviewFile, ReviewStore, SavedReview, Side, Snapshot, StoreError, Touched,
    WatchGuard,
};
use diff_loop_git::Git;
use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Error as TauriError, Manager, Result as TauriResult, State, WebviewWindow,
    async_runtime::spawn_blocking,
    ipc::{Channel, Response},
};
use tauri_plugin_window_state::StateFlags;
use thiserror::Error;
use ts_rs::TS;

/// An open repository, shared with the blocking task that reads it.
type Shared = Arc<dyn Repository + Send + Sync>;

/// Opens the repository containing a folder.
type Opener = fn(&Path) -> Result<Shared, RepoError>;

/// The event the front end hears when the open checkout may have changed.
const CHANGED: &str = "repository-changed";

/// The most a [`ReviewPart::Files`] message weighs ([`batches`]), so the
/// webview parses a large review in pieces (ADR 0012); a file heavier on its
/// own is still one piece.
const BATCH_LINES: usize = 2000;

/// How long the hidden window waits for the front end's first paint, which
/// shows it (ADR 0010 §1), before it is shown anyway.
const SHOW_ANYWAY: Duration = Duration::from_secs(3);

/// The checkout the window reviews, once one is open, how to open one, the
/// watch on it, and its last load.
///
/// Locks are taken in field order, `current` first, wherever two are held.
struct Session {
    open: Opener,
    current: Mutex<Option<Shared>>,
    watch: Mutex<Option<Watching>>,
    /// Kept only while a watch runs: without one, nothing says what changed.
    loaded: Mutex<Option<Loaded>>,
    /// Counts loads begun; only the latest may keep what it loaded, so an
    /// older load finishing last cannot replace a newer one.
    loads: Mutex<u64>,
}

/// A running watch, and what it has seen touched since the last load took it.
struct Watching {
    /// Dropping it stops the watch.
    _guard: WatchGuard,
    touched: Arc<Mutex<Touched>>,
}

/// Where reviews are kept between runs.
struct Reviews(Arc<dyn ReviewStore + Send + Sync>);

impl fmt::Debug for Reviews {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Reviews").finish_non_exhaustive()
    }
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
    /// Saved reviews could not be read or written.
    #[error("{error}")]
    Store {
        /// Why.
        error: StoreError,
    },
    /// The work panicked, or its answer could not be sent back: a defect in
    /// the app or a window closing, not the repository.
    #[error("{message}")]
    Internal {
        /// The runtime's description.
        message: String,
    },
}

impl From<TauriError> for CommandError {
    fn from(error: TauriError) -> Self {
        Self::Internal {
            message: error.to_string(),
        }
    }
}

/// What [`load_review`] sends through its channel, in order: the files in
/// batches, then the rest of the review.
#[derive(Debug, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub(crate) enum ReviewPart {
    /// The next files, in path order.
    Files {
        /// As [`batches`] splits them.
        files: Vec<ReviewFile>,
    },
    /// The review, last.
    Rest {
        /// Its `files` are empty: every one came in a `Files` part before it.
        review: Box<Review>,
    },
}

/// `files` in order, in batches that each weigh at most [`BATCH_LINES`],
/// except a file heavier on its own, which goes alone. A file weighs one,
/// plus its diff lines.
fn batches(files: Vec<ReviewFile>) -> Vec<Vec<ReviewFile>> {
    let weight = |file: &ReviewFile| match file {
        ReviewFile::Changed { diff, .. } => match &diff.content {
            Content::Text { hunks } => 1 + hunks.iter().map(|h| h.lines.len()).sum::<usize>(),
            Content::Binary { .. } => 1,
        },
        ReviewFile::Unchanged { .. } => 1,
    };
    files
        .into_iter()
        .fold(
            (Vec::<Vec<ReviewFile>>::new(), 0),
            |(mut out, held), file| {
                let adds = weight(&file);
                match out.last_mut() {
                    Some(batch) if held + adds <= BATCH_LINES => {
                        batch.push(file);
                        (out, held + adds)
                    }
                    _ => {
                        out.push(vec![file]);
                        (out, adds)
                    }
                }
            },
        )
        .0
}

impl From<RepoError> for CommandError {
    fn from(error: RepoError) -> Self {
        Self::Repository { error }
    }
}

impl From<StoreError> for CommandError {
    fn from(error: StoreError) -> Self {
        Self::Store { error }
    }
}

impl Session {
    fn new(open: Opener) -> Self {
        Self {
            open,
            current: Mutex::new(None),
            watch: Mutex::new(None),
            loaded: Mutex::new(None),
            loads: Mutex::new(0),
        }
    }

    fn current(&self) -> Result<Shared, CommandError> {
        lock(&self.current)
            .clone()
            .ok_or(CommandError::NoRepository)
    }

    /// Makes `repository` the open one; the old one's watch stops.
    fn replace(&self, repository: Shared) {
        // Holding `current` throughout makes the swap atomic, so no guard or
        // load for the old repository lands after it.
        let mut current = lock(&self.current);
        *lock(&self.watch) = None;
        *lock(&self.loaded) = None;
        *current = Some(repository);
    }

    /// Keeps `watching` running while `watched` is still the open repository,
    /// and says so; otherwise drops it, which stops it.
    fn keep_watch(&self, watched: &Shared, watching: Watching) -> bool {
        let current = lock(&self.current);
        let open = holds(&current, watched);
        if open {
            *lock(&self.watch) = Some(watching);
            // What changed before the watch started is unknown: drop the last
            // load, and keep no load begun before now.
            *lock(&self.loaded) = None;
            *lock(&self.loads) += 1;
        }
        open
    }

    /// Begins a load of `of`: its number, and the last load with what was
    /// touched since, while a watch runs. Takes both, so a load that fails
    /// leaves the next to read everything.
    fn begin_load(&self, of: &Shared) -> (u64, Option<(Loaded, Touched)>) {
        let current = lock(&self.current);
        let watch = lock(&self.watch);
        let loaded = lock(&self.loaded).take();
        let mut loads = lock(&self.loads);
        *loads += 1;
        let since = watch
            .as_ref()
            .filter(|_| holds(&current, of))
            .and_then(|watching| {
                // Taken even for a full read, which covers it.
                let touched = mem::take(&mut *lock(&watching.touched));
                Some((loaded?, touched))
            });
        (*loads, since)
    }

    /// Keeps `loaded` for the next load, while `of` is still open, a watch
    /// runs, and load `number` is the latest begun.
    fn keep_loaded(&self, of: &Shared, number: u64, loaded: Loaded) {
        let current = lock(&self.current);
        let watch = lock(&self.watch);
        let mut kept = lock(&self.loaded);
        if holds(&current, of) && watch.is_some() && *lock(&self.loads) == number {
            *kept = Some(loaded);
        }
    }
}

/// Whether `open` is `repository`.
fn holds(open: &Option<Shared>, repository: &Shared) -> bool {
    open.as_ref().is_some_and(|c| Arc::ptr_eq(c, repository))
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

/// Runs blocking work (a repository, the review store) off the async runtime.
async fn blocking<T: Send + 'static, E: Send + 'static>(
    work: impl FnOnce() -> Result<T, E> + Send + 'static,
) -> Result<T, CommandError>
where
    CommandError: From<E>,
{
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
        Ok::<_, RepoError>((repository, opening))
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
    let touched = Arc::new(Mutex::new(Touched::default()));
    let seen = Arc::clone(&touched);
    let guard = blocking(move || {
        repository.watch(Box::new(move |more| {
            lock(&seen).add(more);
            // Emitting fails only while the app shuts down.
            let _ = app.emit(CHANGED, ());
        }))
    })
    .await?;
    let watching = Watching {
        _guard: guard,
        touched,
    };
    Ok(session.keep_watch(&watched, watching))
}

/// Branches and tags the open checkout can be compared with.
#[tauri::command]
async fn refs(session: State<'_, Session>) -> Result<Vec<BaseRef>, CommandError> {
    let repository = session.current()?;
    blocking(move || repository.refs()).await
}

/// Sends the open checkout against `base` through `parts`, with `comments`
/// moved onto their code; files the front end already holds (`known`) are
/// named, not sent. While a watch runs, a load after the first reads again
/// only what it saw touched, unless that needs everything (ADR 0005 §3).
#[tauri::command]
async fn load_review(
    base: Base,
    comments: Vec<Comment>,
    known: Vec<KnownFile>,
    parts: Channel<ReviewPart>,
    session: State<'_, Session>,
) -> Result<(), CommandError> {
    let repository = session.current()?;
    let (number, since) = session.begin_load(&repository);
    let reading = Arc::clone(&repository);
    let (mut review, loaded) =
        blocking(move || diff_loop_core::load(&*reading, base, comments, known, since)).await?;
    session.keep_loaded(&repository, number, loaded);
    for files in batches(mem::take(&mut review.files)) {
        parts.send(ReviewPart::Files { files })?;
    }
    parts.send(ReviewPart::Rest {
        review: Box::new(review),
    })?;
    Ok(())
}

/// A value that changes whenever [`load_review`] for `base` would.
#[tauri::command]
async fn fingerprint(base: Base, session: State<'_, Session>) -> Result<String, CommandError> {
    let repository = session.current()?;
    blocking(move || repository.fingerprint(&base)).await
}

/// How many files the open checkout has not committed, untracked ones included.
#[tauri::command]
async fn uncommitted_files(session: State<'_, Session>) -> Result<u32, CommandError> {
    let repository = session.current()?;
    blocking(move || repository.uncommitted_files()).await
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

/// The review saved for the working tree at `root`; empty when none is.
#[tauri::command]
async fn saved_review(
    root: String,
    reviews: State<'_, Reviews>,
) -> Result<SavedReview, CommandError> {
    let store = Arc::clone(&reviews.0);
    blocking(move || store.saved(&root)).await
}

/// Keeps `review` for the working tree at `root`; an empty one removes it.
#[tauri::command]
async fn save_review(
    root: String,
    review: SavedReview,
    reviews: State<'_, Reviews>,
) -> Result<(), CommandError> {
    let store = Arc::clone(&reviews.0);
    blocking(move || store.save(&root, &review)).await
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

/// Shows `window` after [`SHOW_ANYWAY`] if the front end has not, so a front
/// end that fails to start still leaves a window to see.
fn show_anyway(window: WebviewWindow) {
    thread::spawn(move || {
        thread::sleep(SHOW_ANYWAY);
        if window.is_visible().is_ok_and(|visible| !visible) {
            // Fails only once the window is gone, when nothing is left to show.
            let _ = window.show();
        }
    });
}

/// Builds and runs the app until its last window closes.
///
/// # Errors
/// When the Tauri runtime cannot start: no window system, or a broken bundle.
pub fn run() -> TauriResult<()> {
    #[cfg(target_os = "linux")]
    renderer::choose();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Not `VISIBLE`: the front end shows the window once it has painted.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED
                        | StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .setup(|app| {
            // The review store's adapter (ADR 0004 §2).
            let file = app.path().app_data_dir()?.join("reviews.json");
            app.manage(Reviews(Arc::new(reviews::JsonReviews::new(file))));
            if let Some(window) = app.get_webview_window("main") {
                show_anyway(window);
            }
            #[cfg(target_os = "linux")]
            if let Some(portal) = appearance::follow(app.handle()) {
                app.manage(portal);
            }
            Ok(())
        })
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
            saved_review,
            save_review,
            uncommitted_files,
        ])
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use std::{
        process::Command,
        sync::atomic::{AtomicBool, Ordering},
    };

    use diff_loop_core::{FileDiff, Hunk, Line, Status};
    use tauri::async_runtime::block_on;
    use tempfile::TempDir;

    use super::*;

    /// A changed text file whose one hunk adds `lines` lines.
    fn changed(path: &str, lines: u32) -> ReviewFile {
        let hunk = Hunk {
            old_start: 0,
            new_start: 1,
            section: String::new(),
            lines: (1..=lines)
                .map(|new| Line::Added {
                    new,
                    text: String::new(),
                })
                .collect(),
        };
        ReviewFile::Changed {
            signature: path.to_owned(),
            diff: FileDiff {
                path: path.to_owned(),
                status: Status::Added,
                content: Content::Text { hunks: vec![hunk] },
            },
        }
    }

    fn paths(batches: &[Vec<ReviewFile>]) -> Vec<Vec<&str>> {
        batches
            .iter()
            .map(|batch| {
                batch
                    .iter()
                    .map(|file| match file {
                        ReviewFile::Changed { diff, .. } => diff.path.as_str(),
                        ReviewFile::Unchanged { path, .. } => path.as_str(),
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn no_files_make_no_batches() {
        assert!(batches(vec![]).is_empty());
    }

    #[test]
    fn files_share_a_batch_until_the_next_would_pass_batch_lines() {
        // Each weighs half a batch: one, plus its lines.
        let half = u32::try_from(BATCH_LINES / 2 - 1).unwrap();
        let files = vec![changed("a", half), changed("b", half), changed("c", 0)];
        assert_eq!(paths(&batches(files)), vec![vec!["a", "b"], vec!["c"]]);
    }

    /// Regression: a large file after a small one joined the small one's batch.
    #[test]
    fn a_file_heavier_than_a_batch_goes_alone_wherever_it_comes() {
        let big = u32::try_from(BATCH_LINES * 3).unwrap();
        let unchanged = ReviewFile::Unchanged {
            path: "d".to_owned(),
            signature: "s".to_owned(),
        };
        let files = vec![
            changed("a", 10),
            changed("b", big),
            changed("c", big),
            unchanged,
        ];
        assert_eq!(
            paths(&batches(files)),
            vec![vec!["a"], vec!["b"], vec!["c"], vec!["d"]]
        );
    }

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

    /// A watch that sets `stopped` when dropped.
    fn watching(stopped: &Arc<AtomicBool>) -> Watching {
        Watching {
            _guard: Box::new(Stops(Arc::clone(stopped))),
            touched: Arc::new(Mutex::new(Touched::default())),
        }
    }

    fn loaded(repository: &Shared) -> Loaded {
        diff_loop_core::load(&**repository, Base::Uncommitted, vec![], vec![], None)
            .unwrap()
            .1
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
        assert!(session.keep_watch(&first, watching(&stopped)));
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
        assert!(!session.keep_watch(&first, watching(&stopped)));
        assert!(stopped.load(Ordering::SeqCst));
    }

    /// A load of `repository` that began and finished.
    fn load_and_keep(session: &Session, repository: &Shared) {
        let (number, _) = session.begin_load(repository);
        session.keep_loaded(repository, number, loaded(repository));
    }

    #[test]
    fn without_a_watch_no_load_is_kept() {
        let (_dir, repository) = git_repository();
        let session = Session::new(open_git);
        session.replace(Arc::clone(&repository));
        load_and_keep(&session, &repository);
        assert!(lock(&session.loaded).is_none());
        assert!(session.begin_load(&repository).1.is_none());
    }

    #[test]
    fn while_watching_a_load_takes_the_last_and_what_was_touched() {
        let (_dir, repository) = git_repository();
        let session = Session::new(open_git);
        session.replace(Arc::clone(&repository));
        let stopped = Arc::new(AtomicBool::new(false));
        let watch = watching(&stopped);
        let touched = Arc::clone(&watch.touched);
        assert!(session.keep_watch(&repository, watch));
        load_and_keep(&session, &repository);
        lock(&touched).add(Touched::Paths(["a.ts".to_owned()].into()));
        let (_, since) = session.begin_load(&repository);
        let (_, seen) = since.unwrap();
        assert_eq!(seen, Touched::Paths(["a.ts".to_owned()].into()));
        assert_eq!(*lock(&touched), Touched::default());
        assert!(
            session.begin_load(&repository).1.is_none(),
            "taken, not copied"
        );
    }

    #[test]
    fn a_new_watch_forgets_the_last_load() {
        let (_dir, repository) = git_repository();
        let session = Session::new(open_git);
        session.replace(Arc::clone(&repository));
        let stopped = Arc::new(AtomicBool::new(false));
        assert!(session.keep_watch(&repository, watching(&stopped)));
        load_and_keep(&session, &repository);
        assert!(session.keep_watch(&repository, watching(&stopped)));
        assert!(session.begin_load(&repository).1.is_none());
    }

    /// Regression: a load begun before a watch started was kept after it.
    #[test]
    fn a_load_begun_before_the_watch_is_not_kept() {
        let (_dir, repository) = git_repository();
        let session = Session::new(open_git);
        session.replace(Arc::clone(&repository));
        let (before, _) = session.begin_load(&repository);
        let stopped = Arc::new(AtomicBool::new(false));
        assert!(session.keep_watch(&repository, watching(&stopped)));
        session.keep_loaded(&repository, before, loaded(&repository));
        assert!(lock(&session.loaded).is_none());
    }

    #[test]
    fn a_load_of_a_repository_no_longer_open_is_not_kept() {
        let (_dir, first) = git_repository();
        let (_other, second) = git_repository();
        let session = Session::new(open_git);
        session.replace(Arc::clone(&second));
        let stopped = Arc::new(AtomicBool::new(false));
        assert!(session.keep_watch(&second, watching(&stopped)));
        load_and_keep(&session, &first);
        assert!(lock(&session.loaded).is_none());
    }

    /// Regression: an older load finishing last replaced a newer one.
    #[test]
    fn only_the_latest_load_begun_is_kept() {
        let (_dir, repository) = git_repository();
        let session = Session::new(open_git);
        session.replace(Arc::clone(&repository));
        let stopped = Arc::new(AtomicBool::new(false));
        assert!(session.keep_watch(&repository, watching(&stopped)));
        let (older, _) = session.begin_load(&repository);
        let (newer, _) = session.begin_load(&repository);
        session.keep_loaded(&repository, older, loaded(&repository));
        assert!(lock(&session.loaded).is_none());
        session.keep_loaded(&repository, newer, loaded(&repository));
        assert!(lock(&session.loaded).is_some());
    }
}
