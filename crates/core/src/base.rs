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
    /// How many commits it has that the checkout lacks: the checkout is this
    /// many behind it, as `git status` counts. `None` when unknown.
    pub behind: Option<u32>,
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

/// The base a newly opened checkout is compared with: the repository's
/// default branch, local copy first, or only the uncommitted changes when the
/// checkout is that branch or none exists.
///
/// `remote_default` is the remote's default branch, short name (`origin/main`).
#[must_use]
pub(crate) fn default_base(head: &Head, refs: &[BaseRef], remote_default: Option<&str>) -> Base {
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
    match candidates
        .into_iter()
        .find(|name| has(name) || is_current(name))
    {
        Some(name) if !is_current(name) => Base::Ref {
            name: name.to_owned(),
        },
        _ => Base::Uncommitted,
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
                behind: None,
            })
            .collect()
    }

    fn on(branch: &str) -> Head {
        Head::Branch {
            name: branch.to_owned(),
        }
    }

    fn named(name: &str) -> Base {
        Base::Ref {
            name: name.to_owned(),
        }
    }

    #[test]
    fn prefers_the_local_copy_of_the_remote_default() {
        let refs = refs(&["trunk", "origin/trunk", "main"]);
        assert_eq!(
            default_base(&on("agent/x"), &refs, Some("origin/trunk")),
            named("trunk")
        );
    }

    #[test]
    fn falls_back_to_the_remote_default_when_there_is_no_local_copy() {
        let refs = refs(&["origin/trunk"]);
        assert_eq!(
            default_base(&on("agent/x"), &refs, Some("origin/trunk")),
            named("origin/trunk")
        );
    }

    #[test]
    fn falls_back_to_main_then_master_without_a_remote_default() {
        assert_eq!(
            default_base(&on("x"), &refs(&["master", "main"]), None),
            named("main")
        );
        assert_eq!(
            default_base(&on("x"), &refs(&["master"]), None),
            named("master")
        );
        assert_eq!(
            default_base(&on("x"), &refs(&["origin/main"]), None),
            named("origin/main")
        );
    }

    #[test]
    fn on_the_default_branch_only_uncommitted_changes_are_compared() {
        let refs = refs(&["main", "origin/main"]);
        assert_eq!(
            default_base(&on("main"), &refs, Some("origin/main")),
            Base::Uncommitted
        );
    }

    #[test]
    fn on_main_a_master_branch_is_not_the_base() {
        // `refs` leaves out the checked-out branch.
        assert_eq!(
            default_base(&on("main"), &refs(&["master"]), None),
            Base::Uncommitted
        );
    }

    #[test]
    fn with_no_known_branch_only_uncommitted_changes_are_compared() {
        assert_eq!(
            default_base(&on("x"), &refs(&["feature"]), None),
            Base::Uncommitted
        );
    }

    #[test]
    fn a_detached_head_compares_with_the_default_branch() {
        let head = Head::Detached {
            commit: "4e1b2a0".into(),
        };
        assert_eq!(default_base(&head, &refs(&["main"]), None), named("main"));
    }
}
