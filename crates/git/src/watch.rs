//! Watching a working tree and its git directories for changes.

use std::{
    path::PathBuf,
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::Duration,
};

use diff_loop_core::{OnChange, RepoError, WatchGuard};
use notify::{Error as NotifyError, Event, RecursiveMode, Watcher};

/// Quiet time after the last event before `on_change` runs: a checkout, a
/// commit or a build writes many files at once.
const SETTLE: Duration = Duration::from_millis(250);

/// Watches each of `paths` recursively and calls `on_change` once per burst
/// of events, until the returned guard is dropped.
///
/// # Errors
/// [`RepoError::Failed`] when the platform refuses a watch (on Linux, the
/// inotify watch limit).
pub(crate) fn watch(paths: &[PathBuf], on_change: OnChange) -> Result<WatchGuard, RepoError> {
    let failed = |e: NotifyError| RepoError::Failed {
        message: format!("cannot watch the repository: {e}"),
    };
    let (events, bursts) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event: Result<Event, NotifyError>| {
        if event.is_ok() {
            // The receiver is gone only after the guard dropped.
            let _ = events.send(());
        }
    })
    .map_err(failed)?;
    for path in paths {
        watcher
            .watch(path, RecursiveMode::Recursive)
            .map_err(failed)?;
    }
    // Ends when the guard drops the watcher, and with it the sender.
    thread::spawn(move || {
        while bursts.recv().is_ok() {
            // Three outcomes, so not `while let`: more events extend the
            // burst, quiet ends it, a dropped guard ends the thread.
            loop {
                match bursts.recv_timeout(SETTLE) {
                    Ok(()) => {}
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            on_change();
        }
    });
    Ok(Box::new(watcher))
}
