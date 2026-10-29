//! What the checkout is compared with, and which base to start from.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::repository::Head;

/// What the checkout is compared with.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Base {
    /// Everything since the checkout diverged from this branch, tag or commit,
    /// uncommitted changes included.
    Ref {
        /// As the user or git names it: `main`, `origin/main`, `v1.2`, `a1f3c9e`.
        name: String,
    },
    /// Only what is not yet committed, untracked files included.
    Uncommitted,
    /// Only the commit at `HEAD`.
    LastCommit,
}

/// A branch or tag the user can compare with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BaseRef {
    /// Short name, as `git` prints it.
    pub name: String,
    /// Where it lives.
    pub kind: RefKind,
    /// The remote a remote-tracking branch is on (`team/fork` for
    /// `team/fork/fix`); `None` for a branch or tag of this repository.
    pub remote: Option<String>,
    /// When it last moved: its commit's committer date, or an annotated
    /// tag's tagger date, in milliseconds since the Unix epoch. `None` when
    /// git gives none.
    #[ts(type = "number | null")]
    pub updated: Option<i64>,
}

/// What the checkout can be compared with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BaseChoices {
    /// As [`Repository::refs`](crate::Repository::refs) lists them.
    pub refs: Vec<BaseRef>,
    /// The [`default_branch`].
    pub default_branch: Option<String>,
}

/// Where a [`BaseRef`] lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RefKind {
    /// A local branch.
    Branch,
    /// A remote-tracking branch.
    Remote,
    /// A tag.
    Tag,
}

/// Names tried, in order, when the remote names no default branch.
const CONVENTIONAL: [&str; 4] = ["main", "master", "origin/main", "origin/master"];

/// The repository's default branch, local copy first, unless the checkout is
/// that branch: what a newly opened checkout is compared with. `None` when
/// the checkout is that branch or none exists.
///
/// `remote_default` is the remote's default branch, short name (`origin/main`).
#[must_use]
pub(crate) fn default_branch(
    head: &Head,
    refs: &[BaseRef],
    remote_default: Option<&str>,
) -> Option<String> {
    let has = |name: &str| refs.iter().any(|r| r.name == name);
    let local = remote_default
        .and_then(|remote| remote.split_once('/'))
        .map(|(_, b)| b);
    let candidates = local.into_iter().chain(remote_default).chain(CONVENTIONAL);
    let current = match head {
        Head::Branch { name } => Some(name.as_str()),
        Head::Detached { .. } => None,
    };
    let is_current = |name: &str| {
        current.is_some_and(|c| c == name || name.split_once('/').is_some_and(|(_, b)| b == c))
    };
    // The checked-out branch counts as existing: `refs` leaves it out.
    candidates
        .into_iter()
        .find(|name| has(name) || is_current(name))
        .filter(|name| !is_current(name))
        .map(str::to_owned)
}

/// The base a newly opened checkout is compared with: its [`default_branch`],
/// or with none, only the uncommitted changes, or the last commit on a
/// branch with no working tree, which has none (ADR 0026 §3).
#[must_use]
pub(crate) fn default_base(default_branch: Option<&str>, has_worktree: bool) -> Base {
    match default_branch {
        Some(name) => Base::Ref {
            name: name.to_owned(),
        },
        None if has_worktree => Base::Uncommitted,
        None => Base::LastCommit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refs(names: &[&str]) -> Vec<BaseRef> {
        names
            .iter()
            .map(|n| BaseRef {
                name: (*n).to_owned(),
                kind: if n.contains('/') {
                    RefKind::Remote
                } else {
                    RefKind::Branch
                },
                remote: n.split_once('/').map(|(remote, _)| remote.to_owned()),
                updated: None,
            })
            .collect()
    }

    fn on(branch: &str) -> Head {
        Head::Branch {
            name: branch.to_owned(),
        }
    }

    #[test]
    fn prefers_the_local_copy_of_the_remote_default() {
        let refs = refs(&["trunk", "origin/trunk", "main"]);
        assert_eq!(
            default_branch(&on("agent/x"), &refs, Some("origin/trunk")),
            Some("trunk".to_owned())
        );
    }

    #[test]
    fn falls_back_to_the_remote_default_when_there_is_no_local_copy() {
        let refs = refs(&["origin/trunk"]);
        assert_eq!(
            default_branch(&on("agent/x"), &refs, Some("origin/trunk")),
            Some("origin/trunk".to_owned())
        );
    }

    #[test]
    fn falls_back_to_main_then_master_without_a_remote_default() {
        assert_eq!(
            default_branch(&on("x"), &refs(&["master", "main"]), None),
            Some("main".to_owned())
        );
        assert_eq!(
            default_branch(&on("x"), &refs(&["master"]), None),
            Some("master".to_owned())
        );
        assert_eq!(
            default_branch(&on("x"), &refs(&["origin/main"]), None),
            Some("origin/main".to_owned())
        );
    }

    #[test]
    fn on_the_default_branch_there_is_no_default_to_compare_with() {
        let refs = refs(&["main", "origin/main"]);
        assert_eq!(
            default_branch(&on("main"), &refs, Some("origin/main")),
            None
        );
    }

    #[test]
    fn on_main_a_master_branch_is_not_the_default() {
        // `refs` leaves out the checked-out branch.
        assert_eq!(default_branch(&on("main"), &refs(&["master"]), None), None);
    }

    #[test]
    fn with_no_known_branch_there_is_no_default() {
        assert_eq!(default_branch(&on("x"), &refs(&["feature"]), None), None);
    }

    #[test]
    fn a_detached_head_has_the_default_branch() {
        let head = Head::Detached {
            commit: "4e1b2a0".into(),
        };
        assert_eq!(
            default_branch(&head, &refs(&["main"]), None),
            Some("main".to_owned())
        );
    }

    #[test]
    fn with_no_default_branch_a_branch_without_a_worktree_starts_from_its_last_commit() {
        assert_eq!(default_base(None, true), Base::Uncommitted);
        assert_eq!(default_base(None, false), Base::LastCommit);
        let main = Base::Ref {
            name: "main".into(),
        };
        assert_eq!(default_base(Some("main"), false), main);
    }
}
