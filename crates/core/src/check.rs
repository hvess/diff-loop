//! A project's branches, as the branch switcher lists them, and the deletion
//! of the kept reviews whose branch is gone (ADR 0026 §6, ADR 0035).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::{
    project::{Branch, Project},
    repository::RepoError,
    saved::{ReviewKey, ReviewStore, SavedReview, StoreError},
};

/// A project as the branch switcher shows it ([`check_kept`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectCheck {
    /// As [`Project::branches`] lists them.
    pub branches: Vec<Branch>,
    /// The reviews whose branch is gone, to be deleted with it.
    pub gone: Vec<GoneReview>,
}

/// A kept review whose branch was deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GoneReview {
    /// The review.
    pub key: ReviewKey,
    /// How many comments it held, which go with it.
    pub comments: u32,
}

/// Why [`check_kept`] could not check a project.
#[derive(Debug, Error)]
pub enum CheckError {
    /// The project could not be read; nothing was deleted.
    #[error(transparent)]
    Repository(#[from] RepoError),
    /// The reviews kept could not be read or written.
    #[error(transparent)]
    Store(#[from] StoreError),
}

/// The project whose common git directory is `project`, read through `repo`,
/// with its reviews kept in `store`: its branches, and the reviews whose
/// branch is gone, which are deleted with it (ADR 0026 §6). One read of
/// `store`, and one save per review gone.
///
/// # Errors
/// [`CheckError::Repository`] when the project cannot be read, and then
/// nothing is deleted; [`CheckError::Store`] when the reviews cannot be read,
/// or one gone cannot be deleted.
pub fn check_kept(
    repo: &(impl Project + ?Sized),
    store: &(impl ReviewStore + ?Sized),
    project: &str,
) -> Result<ProjectCheck, CheckError> {
    let kept: Vec<(ReviewKey, SavedReview)> = store
        .kept()?
        .into_iter()
        .filter(|(key, _)| key.project == project)
        .collect();
    let checked = check(repo, &kept)?;
    for gone in &checked.gone {
        store.save(&gone.key, &SavedReview::default())?;
    }
    Ok(checked)
}

/// `project`'s branches, and which of `reviews` (its own, as kept) have none
/// any more. One [`Project::branches`]; O(branches + reviews).
fn check(
    project: &(impl Project + ?Sized),
    reviews: &[(ReviewKey, SavedReview)],
) -> Result<ProjectCheck, RepoError> {
    let branches = project.branches()?;
    let named: HashSet<&str> = branches.iter().map(|b| b.name.as_str()).collect();
    let gone = reviews
        .iter()
        .filter(|(key, _)| !named.contains(key.branch.as_str()))
        .map(|(key, review)| GoneReview {
            key: key.clone(),
            comments: u32::try_from(review.comments.len()).unwrap_or(u32::MAX),
        })
        .collect();
    Ok(ProjectCheck { branches, gone })
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::BTreeMap};

    use super::*;
    use crate::{
        anchor::{AnchorState, Comment, Target},
        project::Location,
        repository::WatchGuard,
        saved::{OnReviewChange, Seen},
    };

    /// Reviews kept in memory.
    #[derive(Default)]
    struct Kept(RefCell<BTreeMap<ReviewKey, SavedReview>>);

    impl ReviewStore for Kept {
        fn saved(&self, key: &ReviewKey) -> Result<SavedReview, StoreError> {
            Ok(self.0.borrow().get(key).cloned().unwrap_or_default())
        }
        fn save(&self, key: &ReviewKey, review: &SavedReview) -> Result<(), StoreError> {
            let mut kept = self.0.borrow_mut();
            if review.is_empty() {
                kept.remove(key);
            } else {
                kept.insert(key.clone(), review.clone());
            }
            Ok(())
        }
        fn kept(&self) -> Result<Vec<(ReviewKey, SavedReview)>, StoreError> {
            Ok(self.0.borrow().clone().into_iter().collect())
        }
        fn change(
            &self,
            key: &ReviewKey,
            change: &mut dyn FnMut(&mut SavedReview),
        ) -> Result<SavedReview, StoreError> {
            let mut review = self.saved(key)?;
            change(&mut review);
            self.save(key, &review)?;
            Ok(review)
        }
        fn location(&self, _: &ReviewKey) -> Option<String> {
            None
        }
        fn watch(&self, _: &ReviewKey, _: OnReviewChange) -> Result<WatchGuard, StoreError> {
            Ok(Box::new(()))
        }
    }

    /// A project whose branches cannot be read.
    struct Unreadable;

    impl Project for Unreadable {
        fn branches(&self) -> Result<Vec<Branch>, RepoError> {
            Err(RepoError::Failed {
                message: "gone away".into(),
            })
        }
        fn worktree_of(&self, _: &str) -> Result<Option<String>, RepoError> {
            Ok(None)
        }
    }

    #[test]
    fn a_review_whose_branch_is_gone_is_deleted_and_only_that_projects() {
        let store = Kept::default();
        let other = ReviewKey {
            project: "/q/.git".into(),
            branch: "gone".into(),
        };
        for (key, review) in [kept("a", "1", 1), kept("gone", "5", 2)] {
            store.save(&key, &review).unwrap();
        }
        store.save(&other, &kept("gone", "5", 1).1).unwrap();
        let checked = check_kept(&Two, &store, "/p/.git").unwrap();
        assert_eq!(checked.gone.len(), 1);
        let left: Vec<ReviewKey> = store.kept().unwrap().into_iter().map(|(k, _)| k).collect();
        assert_eq!(
            left,
            [kept("a", "1", 0).0, other],
            "another project's is left alone"
        );
    }

    #[test]
    fn a_project_that_cannot_be_read_deletes_nothing() {
        let store = Kept::default();
        let (key, review) = kept("gone", "5", 1);
        store.save(&key, &review).unwrap();
        assert!(matches!(
            check_kept(&Unreadable, &store, "/p/.git"),
            Err(CheckError::Repository(_))
        ));
        assert_eq!(store.kept().unwrap().len(), 1);
    }

    /// Branches `a`, at commit `2`, and `b`, at `9`.
    struct Two;

    impl Project for Two {
        fn branches(&self) -> Result<Vec<Branch>, RepoError> {
            let branch = |name: &str, commit: &str| Branch {
                name: name.into(),
                commit: Some(commit.into()),
                updated: None,
                location: Location::Local {
                    remote: None,
                    worktree: None,
                },
            };
            Ok(vec![branch("a", "2"), branch("b", "9")])
        }
        fn worktree_of(&self, _: &str) -> Result<Option<String>, RepoError> {
            Ok(None)
        }
    }

    fn kept(branch: &str, seen: &str, comments: usize) -> (ReviewKey, SavedReview) {
        let comment = |i: usize| Comment {
            id: i.to_string(),
            path: "a.ts".into(),
            target: Target::File,
            text: "t".into(),
            suggestion: None,
            state: AnchorState::Current,
            place: None,
            sent: None,
            resolved: None,
            note: None,
            question: false,
        };
        (
            ReviewKey {
                project: "/p/.git".into(),
                branch: branch.into(),
            },
            SavedReview {
                comments: (0..comments).map(comment).collect(),
                seen: Some(Seen {
                    commit: seen.into(),
                    at: 0,
                }),
                ..SavedReview::default()
            },
        )
    }

    #[test]
    fn a_review_whose_branch_is_gone_is_named_with_its_comments() {
        let check = check(
            &Two,
            &[kept("a", "1", 1), kept("b", "9", 0), kept("gone", "5", 2)],
        )
        .unwrap();
        assert_eq!(check.branches.len(), 2);
        assert_eq!(
            check.gone,
            [GoneReview {
                key: kept("gone", "5", 0).0,
                comments: 2
            }]
        );
    }
}
