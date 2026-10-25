//! A repository as a whole: its branches, and the worktree each is checked
//! out in (ADR 0026 §7).

use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

use diff_loop_core::{Branch, Location, Project, RepoError};

use crate::{
    GitProgram,
    command::{Outcome, Runner},
};

/// A repository read from its common git directory, whatever worktrees it has.
#[derive(Debug, Clone)]
pub struct GitProject {
    run: Runner,
}

impl GitProject {
    /// The repository whose common git directory is `project`, as
    /// [`diff_loop_core::Checkout::project`] names it, run with `git`.
    ///
    /// # Errors
    /// [`RepoError::NotARepository`] when `project` is no git directory;
    /// [`RepoError::Failed`] when `git` cannot run.
    pub fn open(git: &GitProgram, project: &Path) -> Result<Self, RepoError> {
        let run = Runner::new(git.path(), project.to_path_buf());
        let not_a_repository = || RepoError::NotARepository {
            path: project.display().to_string(),
        };
        if !project.is_dir() {
            return Err(not_a_repository());
        }
        match run.outcome(&["rev-parse", "--is-inside-git-dir"])? {
            Outcome::Success(out) if out.trim() == "true" => Ok(Self { run }),
            _ => Err(not_a_repository()),
        }
    }

    /// What it runs `git` with, in the common git directory.
    pub(crate) fn runner(&self) -> &Runner {
        &self.run
    }

    /// [`GitProject::runner`], taking the project.
    pub(crate) fn into_runner(self) -> Runner {
        self.run
    }

    /// [`Project::branches`], each with the ref it is read from: the local
    /// branch, else the remote one.
    pub(crate) fn listed(&self) -> Result<Vec<(Branch, String)>, RepoError> {
        let refs = self.run.stdout(&[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname)%00%(objectname)%00%(upstream)%00%(creatordate:unix)",
            "refs/heads",
            "refs/remotes",
        ])?;
        Ok(fold(
            refs.lines().filter_map(Ref::parse).collect(),
            &self.worktrees()?,
        ))
    }

    /// Branch ref → the root of the worktree it is checked out in.
    fn worktrees(&self) -> Result<BTreeMap<String, String>, RepoError> {
        let porcelain = self.run.stdout(&["worktree", "list", "--porcelain"])?;
        Ok(checked_out(&porcelain))
    }
}

impl Project for GitProject {
    fn branches(&self) -> Result<Vec<Branch>, RepoError> {
        Ok(self
            .listed()?
            .into_iter()
            .map(|(branch, _)| branch)
            .collect())
    }

    fn worktree_of(&self, branch: &str) -> Result<Option<String>, RepoError> {
        Ok(self.worktrees()?.remove(&format!("refs/heads/{branch}")))
    }
}

/// The absolute common git directory of the repository `run` runs in.
pub(crate) fn common_dir(run: &Runner) -> Result<PathBuf, RepoError> {
    let out = run.stdout(&["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
    Ok(PathBuf::from(out.trim_end_matches('\n')))
}

/// One line of `for-each-ref`.
struct Ref<'a> {
    refname: &'a str,
    commit: &'a str,
    /// The local branch's upstream, as configured; empty for none.
    upstream: &'a str,
    updated: Option<i64>,
}

impl<'a> Ref<'a> {
    fn parse(line: &'a str) -> Option<Self> {
        let mut fields = line.split('\0');
        let (refname, commit, upstream, date) = (
            fields.next()?,
            fields.next()?,
            fields.next()?,
            fields.next()?,
        );
        Some(Self {
            refname,
            commit,
            upstream,
            updated: crate::millis(date),
        })
    }
}

/// Branch ref → the root of the worktree it is checked out in, in ref order, from
/// `worktree list --porcelain`: records split by a blank line, each a
/// `worktree <path>` and, on a branch, a `branch <ref>`. A worktree whose
/// folder is gone (`prunable`) holds nothing.
fn checked_out(porcelain: &str) -> BTreeMap<String, String> {
    porcelain
        .split("\n\n")
        .filter(|record| !record.lines().any(|line| line.starts_with("prunable")))
        .filter_map(|record| {
            let field = |name: &str| record.lines().find_map(|line| line.strip_prefix(name));
            Some((field("branch ")?.to_owned(), field("worktree ")?.to_owned()))
        })
        .collect()
}

/// The refs as branches, one per name (as [`Project::branches`]), in the
/// refs' order: each local branch, its upstream folded into it; then each
/// remote's branch that is no local one's upstream, named without its
/// remote unless that name is taken. A remote's name ends at the first `/`,
/// as the base picker splits it (open-tasks 24). O(refs).
fn fold(refs: Vec<Ref<'_>>, worktrees: &BTreeMap<String, String>) -> Vec<(Branch, String)> {
    let existing: HashSet<&str> = refs.iter().map(|r| r.refname).collect();
    let upstreams: HashSet<&str> = refs
        .iter()
        .filter(|r| r.refname.starts_with("refs/heads/") && existing.contains(r.upstream))
        .map(|r| r.upstream)
        .collect();
    let remote_of = |refname: &str| -> Option<(String, String)> {
        let (remote, name) = refname.strip_prefix("refs/remotes/")?.split_once('/')?;
        Some((remote.to_owned(), name.to_owned()))
    };
    let (locals, others): (Vec<_>, Vec<_>) = refs
        .into_iter()
        .partition(|r| r.refname.starts_with("refs/heads/"));
    let locals: Vec<(Branch, String)> = locals
        .into_iter()
        .filter_map(|local| {
            let name = local.refname.strip_prefix("refs/heads/")?;
            let branch = Branch {
                name: name.to_owned(),
                commit: Some(local.commit.to_owned()),
                updated: local.updated,
                location: Location::Local {
                    remote: Some(local.upstream)
                        .filter(|u| existing.contains(u))
                        .and_then(remote_of)
                        .map(|(remote, _)| remote),
                    worktree: worktrees.get(local.refname).cloned(),
                },
            };
            Some((branch, local.refname.to_owned()))
        })
        .collect();
    // A worktree on a branch with no commit yet (`git init`) has no ref for it; it is a branch still.
    let unborn: Vec<(Branch, String)> = worktrees
        .iter()
        .filter_map(|(refname, root)| {
            let name = refname.strip_prefix("refs/heads/")?;
            if existing.contains(refname.as_str()) {
                return None;
            }
            let branch = Branch {
                name: name.to_owned(),
                commit: None,
                updated: None,
                location: Location::Local {
                    remote: None,
                    worktree: Some(root.clone()),
                },
            };
            Some((branch, refname.clone()))
        })
        .collect();
    // The names given so far: a remote's branch takes its short name only while it is free.
    let mut taken: HashSet<String> = locals
        .iter()
        .chain(&unborn)
        .map(|(b, _)| b.name.clone())
        .collect();
    let remotes = others.into_iter().filter_map(|other| {
        // A remote's `HEAD` is left out as `Repository::refs` leaves it, by
        // the whole refname: a remote may have a `/` in its name.
        if other.refname.ends_with("/HEAD") || upstreams.contains(other.refname) {
            return None;
        }
        let (remote, short) = remote_of(other.refname)?;
        let name = if taken.contains(&short) {
            format!("{remote}/{short}")
        } else {
            short
        };
        taken.insert(name.clone());
        let branch = Branch {
            name,
            commit: Some(other.commit.to_owned()),
            updated: other.updated,
            location: Location::Remote { remote },
        };
        Some((branch, other.refname.to_owned()))
    });
    locals.into_iter().chain(unborn).chain(remotes).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(refname: &str, upstream: &str) -> String {
        format!("{refname}\0c-{refname}\0{upstream}\x001700000000")
    }

    fn names(branches: &[(Branch, String)]) -> Vec<(&str, bool, Option<&str>, &str)> {
        branches
            .iter()
            .map(|(b, refname)| {
                let (local, remote) = match &b.location {
                    Location::Local { remote, .. } => (true, remote.as_deref()),
                    Location::Remote { remote } => (false, Some(remote.as_str())),
                };
                (b.name.as_str(), local, remote, refname.as_str())
            })
            .collect()
    }

    #[test]
    fn a_local_branch_and_its_upstream_are_one_and_a_remote_one_drops_its_remote() {
        let lines = [
            line("refs/heads/main", "refs/remotes/origin/main"),
            line("refs/heads/agent/x", ""),
            line("refs/remotes/origin/main", ""),
            line("refs/remotes/origin/HEAD", ""),
            line("refs/remotes/origin/spike/webp", ""),
        ];
        let refs = lines.iter().filter_map(|l| Ref::parse(l)).collect();
        let worktrees = BTreeMap::from([("refs/heads/agent/x".to_owned(), "/wt/x".to_owned())]);
        let branches = fold(refs, &worktrees);
        assert_eq!(
            names(&branches),
            [
                ("main", true, Some("origin"), "refs/heads/main"),
                ("agent/x", true, None, "refs/heads/agent/x"),
                (
                    "spike/webp",
                    false,
                    Some("origin"),
                    "refs/remotes/origin/spike/webp"
                ),
            ]
        );
        assert_eq!(branches[1].0.worktree(), Some("/wt/x"));
        assert_eq!(branches[0].0.commit.as_deref(), Some("c-refs/heads/main"));
        assert_eq!(branches[0].0.updated, Some(1_700_000_000_000));
    }

    #[test]
    fn a_remote_branch_named_as_a_local_one_it_is_not_the_upstream_of_keeps_its_remote() {
        let lines = [
            line("refs/heads/fix", ""),
            line("refs/remotes/origin/fix", ""),
            line("refs/remotes/up/fix", ""),
        ];
        let refs = lines.iter().filter_map(|l| Ref::parse(l)).collect();
        let branches = fold(refs, &BTreeMap::new());
        assert_eq!(
            names(&branches),
            [
                ("fix", true, None, "refs/heads/fix"),
                (
                    "origin/fix",
                    false,
                    Some("origin"),
                    "refs/remotes/origin/fix"
                ),
                ("up/fix", false, Some("up"), "refs/remotes/up/fix"),
            ]
        );
    }

    /// Regression: a branch with no commit yet left its name free, so a remote's took it too.
    #[test]
    fn a_branch_with_no_commit_yet_takes_its_name_from_a_remote_one() {
        let lines = [line("refs/remotes/origin/fix", "")];
        let refs = lines.iter().filter_map(|l| Ref::parse(l)).collect();
        let worktrees = BTreeMap::from([("refs/heads/fix".to_owned(), "/wt".to_owned())]);
        let branches = fold(refs, &worktrees);
        assert_eq!(
            names(&branches),
            [
                ("fix", true, None, "refs/heads/fix"),
                (
                    "origin/fix",
                    false,
                    Some("origin"),
                    "refs/remotes/origin/fix"
                ),
            ]
        );
    }

    /// Regression: a remote named with a `/` had its `HEAD` listed as a branch, `fork/HEAD`.
    #[test]
    fn a_remotes_head_is_left_out_whatever_the_remote_is_named() {
        let lines = [
            line("refs/remotes/team/fork/HEAD", ""),
            line("refs/remotes/team/fork/fix", ""),
        ];
        let refs = lines.iter().filter_map(|l| Ref::parse(l)).collect();
        let branches = fold(refs, &BTreeMap::new());
        assert_eq!(
            names(&branches),
            [(
                "fork/fix",
                false,
                Some("team"),
                "refs/remotes/team/fork/fix"
            )]
        );
    }

    #[test]
    fn an_upstream_that_is_gone_is_no_remote() {
        let lines = [line("refs/heads/fix", "refs/remotes/origin/fix")];
        let refs = lines.iter().filter_map(|l| Ref::parse(l)).collect();
        let branches = fold(refs, &BTreeMap::new());
        assert_eq!(names(&branches), [("fix", true, None, "refs/heads/fix")]);
    }

    #[test]
    fn worktrees_name_the_branch_each_has_checked_out_and_skip_a_gone_one() {
        let porcelain = "worktree /code/app\nHEAD 1\nbranch refs/heads/main\n\n\
                         worktree /code/app/.wt/x\nHEAD 2\nbranch refs/heads/agent/x\n\n\
                         worktree /code/app/.wt/d\nHEAD 3\ndetached\n\n\
                         worktree /gone\nHEAD 4\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n";
        let map = checked_out(porcelain);
        assert_eq!(map.len(), 2);
        assert_eq!(map["refs/heads/main"], "/code/app");
        assert_eq!(map["refs/heads/agent/x"], "/code/app/.wt/x");
    }
}
