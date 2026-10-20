//! A review is open in one window at a time (ADR 0026 §9): a window holds a
//! lock on a file named for the review while it shows it, so another
//! instance of the app, its own process, finds it taken.

use std::{
    fs::{self, File, TryLockError},
    io,
    path::PathBuf,
    thread,
    time::Duration,
};

use diff_loop_core::ReviewKey;
use thiserror::Error;

/// How often, and how far apart, a claim is tried before the review counts
/// as another window's: another instance's `held_elsewhere` holds a lock for
/// the moment it takes to try it.
const TRIES: u32 = 3;
const APART: Duration = Duration::from_millis(20);

/// Where the lock files are: one per review ever shown, empty.
#[derive(Debug, Clone)]
pub(crate) struct Claims {
    dir: PathBuf,
}

/// A review this window shows; dropped, another window may show it.
#[derive(Debug)]
pub(crate) struct Claim {
    key: ReviewKey,
    /// Holds the lock until dropped.
    _file: File,
}

impl Claim {
    pub(crate) fn key(&self) -> &ReviewKey {
        &self.key
    }
}

/// Why a review could not be claimed.
#[derive(Debug, Error)]
pub(crate) enum Refused {
    /// Another window holds it.
    #[error("another window shows it")]
    Elsewhere,
    /// Its lock file could not be opened or locked.
    #[error("{0}")]
    Failed(#[from] io::Error),
}

impl Claims {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// Claims `key` for this window, unless another window holds it. Blocks
    /// up to [`TRIES`] × [`APART`] while it is held.
    pub(crate) fn take(&self, key: &ReviewKey) -> Result<Claim, Refused> {
        let file = self.open(key)?;
        for tried in 1..=TRIES {
            match file.try_lock() {
                Ok(()) => {
                    return Ok(Claim {
                        key: key.clone(),
                        _file: file,
                    });
                }
                Err(TryLockError::WouldBlock) if tried < TRIES => thread::sleep(APART),
                Err(TryLockError::WouldBlock) => break,
                Err(TryLockError::Error(e)) => return Err(Refused::Failed(e)),
            }
        }
        Err(Refused::Elsewhere)
    }

    /// Whether another window holds `key`: its lock tried once and let go at
    /// once. A review this window claims reads as held too, since a lock
    /// belongs to the handle that took it; the caller leaves that one out.
    pub(crate) fn held_elsewhere(&self, key: &ReviewKey) -> bool {
        // A lock that cannot be tried says nothing of another window.
        self.open(key)
            .is_ok_and(|file| matches!(file.try_lock(), Err(TryLockError::WouldBlock)))
    }

    fn open(&self, key: &ReviewKey) -> io::Result<File> {
        fs::create_dir_all(&self.dir)?;
        fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.dir.join(format!("{:016x}.lock", fnv1a(key))))
    }
}

/// FNV-1a over the key's project and branch: a file name that is the same in
/// every instance and every build, as `DefaultHasher`'s is not, and short
/// where a path may not be.
fn fnv1a(key: &ReviewKey) -> u64 {
    let bytes = key.project.bytes().chain([0]).chain(key.branch.bytes());
    bytes.fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    fn key(branch: &str) -> ReviewKey {
        ReviewKey {
            project: "/p/.git".into(),
            branch: branch.into(),
        }
    }

    #[test]
    fn a_review_claimed_by_one_window_is_refused_to_another_until_let_go() {
        let dir = TempDir::new().unwrap();
        // Each its own, as each running app has.
        let one = Claims::new(dir.path().join("open"));
        let other = Claims::new(dir.path().join("open"));
        let held = one.take(&key("a")).unwrap();
        assert_eq!(held.key(), &key("a"));
        assert!(matches!(other.take(&key("a")), Err(Refused::Elsewhere)));
        assert!(other.held_elsewhere(&key("a")));
        assert!(other.take(&key("b")).is_ok(), "another review is free");
        drop(held);
        assert!(!other.held_elsewhere(&key("a")));
        assert!(other.take(&key("a")).is_ok());
    }

    #[test]
    fn a_review_names_the_same_file_in_every_instance_and_another_names_another() {
        assert_eq!(fnv1a(&key("a")), fnv1a(&key("a")));
        assert_ne!(fnv1a(&key("a")), fnv1a(&key("b")));
        let split = ReviewKey {
            project: "/p/.gita".into(),
            branch: String::new(),
        };
        assert_ne!(fnv1a(&split), fnv1a(&key("a")), "the separator counts");
    }
}
