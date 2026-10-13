//! The port to a version-controlled checkout, and the types that cross it.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::{
    base::{Base, BaseRef},
    diff::{FileDiff, Side},
};

/// A checkout the app reviews: one working tree of one repository.
pub trait Repository {
    /// The repository and what is checked out.
    ///
    /// # Errors
    /// [`RepoError::Failed`] when the repository cannot be read.
    fn checkout(&self) -> Result<Checkout, RepoError>;

    /// Branches and tags the checkout can be compared with, the checked-out
    /// branch excluded.
    ///
    /// # Errors
    /// [`RepoError::Failed`] when the refs cannot be read.
    fn refs(&self) -> Result<Vec<BaseRef>, RepoError>;

    /// The remote's default branch, short name (`origin/main`), if one is known.
    ///
    /// # Errors
    /// [`RepoError::Failed`] when the repository cannot be read.
    fn remote_default(&self) -> Result<Option<String>, RepoError>;

    /// What changed between `base` and the checkout.
    ///
    /// # Errors
    /// [`RepoError::UnknownBase`] when `base` names nothing; [`RepoError::NoCommits`]
    /// when `base` needs a commit the checkout lacks; [`RepoError::Failed`] otherwise.
    fn changes(&self, base: &Base) -> Result<Changes, RepoError>;

    /// As [`Repository::changes`], with only the files at or under `paths`
    /// (relative to the root); none when `paths` is empty. A rename is found
    /// only when both its paths are covered.
    ///
    /// # Errors
    /// As [`Repository::changes`].
    fn changes_in(&self, base: &Base, paths: &BTreeSet<String>) -> Result<Changes, RepoError>;

    /// A value that changes whenever [`Repository::changes`] for `base` would.
    ///
    /// # Errors
    /// As [`Repository::changes`].
    fn fingerprint(&self, base: &Base) -> Result<String, RepoError>;

    /// The bytes of `path` on one side of `snapshot`.
    ///
    /// # Errors
    /// [`RepoError::OutsideRepository`] when `path` leaves the working tree;
    /// [`RepoError::Failed`] when the file cannot be read.
    fn blob(&self, snapshot: &Snapshot, side: Side, path: &str) -> Result<Vec<u8>, RepoError>;

    /// How many commits `to` is ahead of `from`, or `None` when `from` is not
    /// an ancestor of `to` (history was rewritten).
    ///
    /// # Errors
    /// [`RepoError::Failed`] when either commit cannot be read.
    fn commits_between(&self, from: &str, to: &str) -> Result<Option<u32>, RepoError>;

    /// How many files differ from `HEAD`, untracked ones included: what
    /// [`Base::Uncommitted`] would show.
    ///
    /// # Errors
    /// [`RepoError::Failed`] when the checkout cannot be read.
    fn uncommitted_files(&self) -> Result<u32, RepoError>;

    /// Calls `on_change` soon after anything in the checkout or its git state
    /// may have changed, with what was touched, until the returned guard is
    /// dropped. Calls can be spurious: a touched path may not have changed.
    ///
    /// # Errors
    /// [`RepoError::Failed`] when the platform cannot watch the checkout.
    fn watch(&self, on_change: OnChange) -> Result<WatchGuard, RepoError>;
}

/// What [`Repository::watch`] calls; from a background thread.
pub type OnChange = Box<dyn Fn(Touched) + Send + Sync>;

/// What a watch saw touched: in one report, or added up across reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Touched {
    /// Paths relative to the root, files or directories; empty when only git's
    /// own state changed. A fresh snapshot shows a moved `HEAD` or base, not
    /// a change to the index alone (ADR 0005, Consequences).
    Paths(BTreeSet<String>),
    /// More than the watch could name: read everything again.
    Everything,
}

impl Default for Touched {
    fn default() -> Self {
        Self::Paths(BTreeSet::new())
    }
}

/// Past this many paths, what is touched is everything: a build writing
/// thousands of files must not hold every name until the next load.
const MOST_KEPT: usize = 10_000;

impl Touched {
    /// Adds what `other` touched to this.
    pub fn add(&mut self, other: Self) {
        match (&mut *self, other) {
            (Self::Paths(paths), Self::Paths(more)) => {
                paths.extend(more);
                if paths.len() > MOST_KEPT {
                    *self = Self::Everything;
                }
            }
            (this, _) => *this = Self::Everything,
        }
    }
}

/// Keeps a [`Repository::watch`] running; dropping it stops the watch.
pub type WatchGuard = Box<dyn Send>;

/// The repository and what is checked out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Checkout {
    /// The repository's name; a worktree carries its main repository's name.
    pub name: String,
    /// Absolute path of the working tree's root.
    pub root: String,
    /// What is checked out.
    pub head: Head,
    /// Full id of the commit at `HEAD`; `None` before the first commit.
    pub commit: Option<String>,
}

/// What is checked out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Head {
    /// A branch, by short name.
    Branch {
        /// Short name, as `agent/share-rate-limit`.
        name: String,
    },
    /// A commit with no branch.
    Detached {
        /// Abbreviated commit id.
        commit: String,
    },
}

/// What changed between a base and the checkout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Changes {
    /// The two trees compared, for [`Repository::blob`].
    pub snapshot: Snapshot,
    /// In path order; no path appears twice.
    pub files: Vec<FileDiff>,
}

/// The two trees a [`Changes`] compares.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Snapshot {
    /// Full id of the old-side commit; `None` for the empty tree.
    pub old: Option<String>,
    /// The new side.
    pub new: NewSide,
}

/// The new side of a [`Snapshot`].
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum NewSide {
    /// The files on disk.
    WorkingTree,
    /// A commit.
    Commit {
        /// Full commit id.
        id: String,
    },
}

/// Why the repository could not answer.
#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum RepoError {
    /// The folder is neither a repository nor inside one.
    #[error("{path} is not a git repository")]
    NotARepository {
        /// As given.
        path: String,
    },
    /// The base names no branch, tag or commit.
    #[error("{name} is not a branch, tag or commit")]
    UnknownBase {
        /// As given.
        name: String,
    },
    /// The base needs a commit the checkout does not have.
    #[error("the checkout has no commits yet")]
    NoCommits,
    /// A path leaves the working tree.
    #[error("{path} is outside the repository")]
    OutsideRepository {
        /// As given.
        path: String,
    },
    /// Anything else, with the underlying message.
    #[error("{message}")]
    Failed {
        /// Why, in the adapter's words.
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(list: &[&str]) -> Touched {
        Touched::Paths(list.iter().map(|p| (*p).to_owned()).collect())
    }

    #[test]
    fn touched_adds_up_until_it_names_everything() {
        let mut touched = paths(&["a"]);
        touched.add(paths(&["b"]));
        assert_eq!(touched, paths(&["a", "b"]));
        touched.add(Touched::Everything);
        assert_eq!(touched, Touched::Everything);
        touched.add(paths(&["c"]));
        assert_eq!(touched, Touched::Everything);
    }

    #[test]
    fn too_many_paths_are_everything() {
        let mut touched = Touched::default();
        let many: Vec<String> = (0..=MOST_KEPT).map(|i| format!("f{i}")).collect();
        touched.add(Touched::Paths(many.into_iter().collect()));
        assert_eq!(touched, Touched::Everything);
    }
}
