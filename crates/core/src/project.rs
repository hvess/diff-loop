//! The port to a repository with all its worktrees, and its branches
//! (ADR 0026 §7).

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::repository::RepoError;

/// The port to a repository as a whole: its branches, wherever each is
/// checked out.
pub trait Project {
    /// Every branch, local and remote-tracking, one per name: a local branch
    /// and its upstream are one, and a remote's branch is named without its
    /// remote unless that name is taken, by a local branch or by another
    /// remote's branch listed before it (`origin/fix`).
    ///
    /// # Errors
    /// [`RepoError::Failed`] when the repository cannot be read.
    fn branches(&self) -> Result<Vec<Branch>, RepoError>;

    /// The root of the working tree that has local branch `branch` checked
    /// out, if one does: what a review shown from its commits asks on each
    /// poll, so it reads the worktrees alone, not every branch.
    ///
    /// # Errors
    /// [`RepoError::Failed`] when the worktrees cannot be read.
    fn worktree_of(&self, branch: &str) -> Result<Option<String>, RepoError>;

    /// As [`crate::Repository::commits_between`].
    ///
    /// # Errors
    /// [`RepoError::Failed`] when either commit cannot be read.
    fn commits_between(&self, from: &str, to: &str) -> Result<Option<u32>, RepoError>;
}

/// A branch of a [`Project`]: the branch a review is kept for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Branch {
    /// Its name, as [`Project::branches`] gives it: a short name,
    /// `agent/share-retry`, or a remote's branch whose short name was taken,
    /// with its remote, `origin/fix`.
    pub name: String,
    /// Full id of its commit: the local branch's, else the remote one's;
    /// `None` for a branch a worktree has checked out before its first
    /// commit.
    pub commit: Option<String>,
    /// When that commit was made, in milliseconds since the Unix epoch.
    #[ts(type = "number | null")]
    pub updated: Option<i64>,
    /// Where it is.
    pub location: Location,
}

impl Branch {
    /// The root of the working tree that has it checked out, if one does.
    #[must_use]
    pub fn worktree(&self) -> Option<&str> {
        match &self.location {
            Location::Local { worktree, .. } => worktree.as_deref(),
            Location::Remote { .. } => None,
        }
    }
}

/// Where a [`Branch`] is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Location {
    /// A local branch.
    Local {
        /// The remote its upstream is on, if it has one.
        remote: Option<String>,
        /// The root of the working tree that has it checked out, if one does.
        worktree: Option<String>,
    },
    /// A remote's branch alone, which no working tree can have checked out.
    Remote {
        /// The remote.
        remote: String,
    },
}

/// A project's name, from its common git directory (as
/// [`Checkout::project`](crate::Checkout::project)): the folder it is the
/// `.git` of, or a bare one's own name less `.git`.
#[must_use]
pub fn project_name(project: &str) -> String {
    let common = Path::new(project);
    let named = if common.file_name().is_some_and(|n| n == ".git") {
        common.parent()
    } else {
        Some(common)
    };
    named
        .and_then(Path::file_name)
        .map(|n| n.to_string_lossy().trim_end_matches(".git").to_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_project_is_named_for_the_folder_its_git_directory_is_in() {
        assert_eq!(project_name("/code/drive-web/.git"), "drive-web");
        assert_eq!(project_name("/srv/drive-web.git"), "drive-web");
    }
}
