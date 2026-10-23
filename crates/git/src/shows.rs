//! What a [`Git`](crate::Git) shows: a working tree against its `HEAD`, or a
//! branch no working tree has checked out, read from its commits alone (ADR
//! 0026 §3). Everything that differs between the two is here.

use std::{
    fmt,
    path::{Path, PathBuf},
    slice,
};

use diff_loop_core::{Head, NewSide, OnChange, RepoError, WatchGuard};

use crate::{
    command::{Outcome, Runner},
    watch,
};

/// The behaviour that differs between a working tree and a branch's commits.
pub(crate) trait Shows: fmt::Debug + Send + Sync {
    /// The ref whose commit is shown: `HEAD`, or the branch's.
    fn tip_ref(&self) -> &str;

    /// The new side of a snapshot ending at `tip`: the files on disk, or the
    /// branch's commit when there are none.
    fn new_side(&self, tip: String) -> NewSide;

    /// Whether the checkout has a working tree, so its uncommitted changes
    /// can be asked for.
    ///
    /// # Errors
    /// [`RepoError::NotCheckedOut`] for a branch with no working tree.
    fn working_tree(&self) -> Result<(), RepoError>;

    /// What is checked out or shown, and the working tree's root, if any.
    ///
    /// # Errors
    /// [`RepoError::Failed`] when `git` cannot say.
    fn head(&self, run: &Runner) -> Result<(Head, Option<String>), RepoError>;

    /// The full ref shown, which is not offered as a base; none on a
    /// detached `HEAD`.
    ///
    /// # Errors
    /// [`RepoError::Failed`] when `git` cannot say.
    fn shown_ref(&self, run: &Runner) -> Result<Option<String>, RepoError>;

    /// Watches what can change what is shown, in the repository whose
    /// common git directory is `project`.
    ///
    /// # Errors
    /// [`RepoError::Failed`] when the platform refuses a watch.
    fn watch(
        &self,
        run: &Runner,
        project: &Path,
        on_change: OnChange,
    ) -> Result<WatchGuard, RepoError>;
}

/// The working tree `git` runs in.
#[derive(Debug)]
pub(crate) struct WorkingTree;

/// A branch's commits alone, read in the common git directory `git` runs in.
#[derive(Debug)]
pub(crate) struct Branch {
    /// Short name, as [`diff_loop_core::Branch::name`].
    pub(crate) name: String,
    /// The ref read: the local branch, else the remote one.
    pub(crate) refname: String,
}

impl Shows for WorkingTree {
    fn tip_ref(&self) -> &str {
        "HEAD"
    }

    fn new_side(&self, _: String) -> NewSide {
        NewSide::WorkingTree
    }

    fn working_tree(&self) -> Result<(), RepoError> {
        Ok(())
    }

    fn head(&self, run: &Runner) -> Result<(Head, Option<String>), RepoError> {
        // Named as `Project::branches` names it, the ref less `refs/heads/`:
        // `--short` says `heads/fix` when a tag is named `fix` too.
        let head = match run.outcome(&["symbolic-ref", "--quiet", "HEAD"])? {
            Outcome::Success(out) => {
                let full = out.trim();
                Head::Branch {
                    name: full.strip_prefix("refs/heads/").unwrap_or(full).to_owned(),
                }
            }
            Outcome::Failure => Head::Detached {
                commit: run
                    .stdout(&["rev-parse", "--short", "HEAD"])?
                    .trim()
                    .to_owned(),
            },
        };
        Ok((head, Some(run.dir().display().to_string())))
    }

    fn shown_ref(&self, run: &Runner) -> Result<Option<String>, RepoError> {
        Ok(match run.outcome(&["symbolic-ref", "--quiet", "HEAD"])? {
            Outcome::Success(out) => Some(out.trim().to_owned()),
            Outcome::Failure => None,
        })
    }

    fn watch(
        &self,
        run: &Runner,
        project: &Path,
        on_change: OnChange,
    ) -> Result<WatchGuard, RepoError> {
        // A worktree's git directories live outside it: HEAD, the index and
        // refs change there.
        let out = run.stdout(&[
            "rev-parse",
            "--path-format=absolute",
            "--absolute-git-dir",
            "--git-path",
            "index",
        ])?;
        let mut lines = out.lines().map(PathBuf::from);
        let (Some(git_dir), Some(index)) = (lines.next(), lines.next()) else {
            return Err(RepoError::Failed {
                message: format!("git rev-parse named no git directory: {out}"),
            });
        };
        let git_dirs = [project.to_path_buf(), git_dir];
        watch::watch(run.dir(), &git_dirs, Some(&index), on_change)
    }
}

impl Shows for Branch {
    fn tip_ref(&self) -> &str {
        &self.refname
    }

    fn new_side(&self, tip: String) -> NewSide {
        NewSide::Commit { id: tip }
    }

    fn working_tree(&self) -> Result<(), RepoError> {
        Err(RepoError::NotCheckedOut {
            branch: self.name.clone(),
        })
    }

    fn head(&self, _: &Runner) -> Result<(Head, Option<String>), RepoError> {
        Ok((
            Head::Branch {
                name: self.name.clone(),
            },
            None,
        ))
    }

    fn shown_ref(&self, _: &Runner) -> Result<Option<String>, RepoError> {
        Ok(Some(self.refname.clone()))
    }

    fn watch(
        &self,
        _: &Runner,
        project: &Path,
        on_change: OnChange,
    ) -> Result<WatchGuard, RepoError> {
        // Only refs move, and a worktree's `HEAD` when one checks the branch out.
        let common = project.to_path_buf();
        watch::watch(&common, slice::from_ref(&common), None, on_change)
    }
}
