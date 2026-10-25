//! What of a review outlasts a run of the app, and the port to where it is kept.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::{
    anchor::{Comment, Resolution},
    base::Base,
    repository::{Checkout, Head, WatchGuard},
    rounds::Round,
};

/// The folder in a project's common git directory that holds Diff Loop's
/// own files, its reviews among them (ADR 0030 §1).
pub const OWN_FOLDER: &str = "diff-loop";

/// What a review is kept under: one branch of one project, whichever
/// working tree has it checked out, if any (ADR 0026 §1).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReviewKey {
    /// The project: as [`Checkout::project`].
    pub project: String,
    /// The branch's name, as [`crate::Branch::name`]: `agent/share-retry`.
    pub branch: String,
}

impl ReviewKey {
    /// The review `checkout` shows: its branch's. `None` on a detached
    /// `HEAD`, which has no branch to keep a review for (ADR 0026 §5).
    #[must_use]
    pub fn of(checkout: &Checkout) -> Option<Self> {
        match &checkout.head {
            Head::Branch { name } => Some(Self {
                project: checkout.project.clone(),
                branch: name.clone(),
            }),
            Head::Detached { .. } => None,
        }
    }
}

/// A branch's review as kept between runs: one per branch of a project
/// (ADR 0026 §1). A `note` kept by an earlier version is ignored (ADR 0013
/// §3); a review saved without rounds has none (ADR 0015 §9).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavedReview {
    /// As last saved; moved onto their code when the review next loads.
    pub comments: Vec<Comment>,
    /// In order, the latest last; at most 20 (ADR 0015 §9).
    #[serde(default)]
    pub rounds: Vec<Round>,
    /// What the branch was last compared with, shown again when the review
    /// is (ADR 0026 §2).
    #[serde(default)]
    pub base: Option<Base>,
    /// Where the branch was when the review was last shown, so a return can
    /// say whether it moved meanwhile (ADR 0026 §4).
    #[serde(default)]
    pub seen: Option<Seen>,
}

impl SavedReview {
    /// Whether there is nothing to keep: a review starts with its first
    /// comment, and is gone once it has neither comments nor rounds, whatever
    /// its base (ADR 0026 §2).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.comments.is_empty() && self.rounds.is_empty()
    }

    /// This review, about to replace `kept`, with each mark the agent left
    /// in `kept` that this one has not seen: a comment `kept` holds resolved
    /// by the agent stays so while this one's copy is open and unedited
    /// (ADR 0032 §3). O(comments).
    #[must_use]
    pub fn keeping_agent_marks(mut self, kept: &Self) -> Self {
        let marked: HashMap<&str, &Comment> = kept
            .comments
            .iter()
            .filter(|c| c.resolved == Some(Resolution::ByAgent))
            .map(|c| (c.id.as_str(), c))
            .collect();
        for comment in &mut self.comments {
            if let Some(mark) = marked.get(comment.id.as_str())
                && comment.resolved.is_none()
                && comment.text == mark.text
                && comment.suggestion == mark.suggestion
            {
                comment.resolved = mark.resolved;
                comment.note.clone_from(&mark.note);
            }
        }
        self
    }

    /// What the branch switcher says of it (ADR 0035). O(comments).
    #[must_use]
    pub fn summary(&self) -> ReviewSummary {
        let open = self
            .comments
            .iter()
            .filter(|c| c.resolved.is_none())
            .count();
        ReviewSummary {
            open: u32::try_from(open).unwrap_or(u32::MAX),
            seen: self.seen.clone(),
        }
    }
}

/// A branch's commit when its review was last shown, and when.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Seen {
    /// Full commit id.
    pub commit: String,
    /// When the review was last shown, in milliseconds since the Unix epoch.
    #[ts(type = "number")]
    pub at: i64,
}

/// What the branch switcher shows of a kept review ([`SavedReview::summary`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReviewSummary {
    /// The comments not resolved.
    pub open: u32,
    /// As [`SavedReview::seen`].
    pub seen: Option<Seen>,
}

/// Where reviews are kept between runs, by [`ReviewKey`].
pub trait ReviewStore {
    /// The review saved for `key`, or an empty one when none is.
    ///
    /// # Errors
    /// [`StoreError::Failed`] when what is kept cannot be read.
    fn saved(&self, key: &ReviewKey) -> Result<SavedReview, StoreError>;

    /// Keeps `review` for `key` in place of any before it; an empty review
    /// removes the entry. A store an agent also writes to keeps the marks
    /// it left meanwhile that `review` has not seen (ADR 0032 §3,
    /// [`SavedReview::keeping_agent_marks`]).
    ///
    /// # Errors
    /// [`StoreError::Failed`] when it cannot be written, or when what is
    /// kept cannot be read, so writing would lose it.
    fn save(&self, key: &ReviewKey, review: &SavedReview) -> Result<(), StoreError>;

    /// Changes the review kept for `key` with `change` and keeps the result,
    /// as one step no other save comes between; returns what was kept.
    ///
    /// # Errors
    /// As [`ReviewStore::save`].
    fn change(
        &self,
        key: &ReviewKey,
        change: &mut dyn FnMut(&mut SavedReview),
    ) -> Result<SavedReview, StoreError>;

    /// Where the review for `key` is kept, as a path an agent can edit;
    /// `None` when that cannot be named as text.
    fn location(&self, key: &ReviewKey) -> Option<String>;

    /// Calls `on_change` soon after the review for `key` may have changed,
    /// by this process or another (an agent marking a comment resolved, ADR
    /// 0032 §4), until the returned guard is dropped. Calls can be spurious.
    ///
    /// # Errors
    /// [`StoreError::Failed`] when it cannot be watched: the platform
    /// refuses, or the place it is kept in is gone or cannot be made.
    fn watch(&self, key: &ReviewKey, on_change: OnReviewChange) -> Result<WatchGuard, StoreError>;

    /// Every review kept, in key order. A store keeping reviews apart may
    /// leave out one it cannot read, so that it hides no other; [`Self::saved`]
    /// reports it.
    ///
    /// # Errors
    /// [`StoreError::Failed`] when what is kept cannot be read.
    fn kept(&self) -> Result<Vec<(ReviewKey, SavedReview)>, StoreError>;
}

/// What [`ReviewStore::watch`] calls; from a background thread.
pub type OnReviewChange = Box<dyn Fn() + Send + Sync>;

/// Why a [`ReviewStore`] could not answer.
#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum StoreError {
    /// Reading or writing failed, with the underlying message.
    #[error("{message}")]
    Failed {
        /// Why, in the adapter's words.
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anchor::{AnchorState, Place, Target};

    fn comment(id: &str, resolved: Option<Resolution>) -> Comment {
        Comment {
            id: id.into(),
            path: "a.ts".into(),
            target: Target::File,
            text: "t".into(),
            suggestion: None,
            state: AnchorState::Current,
            place: None,
            sent: None,
            resolved,
            note: None,
        }
    }

    fn round(number: u32, at: i64) -> Round {
        Round {
            number,
            at,
            place: Place {
                base: Base::Uncommitted,
                head: Head::Branch { name: "b".into() },
            },
            commit: None,
            markdown: String::new(),
        }
    }

    #[test]
    fn a_review_is_kept_for_a_branch_and_never_for_a_detached_head() {
        let mut checkout = Checkout {
            name: "drive-web".into(),
            project: "/code/drive-web/.git".into(),
            worktree: None,
            head: Head::Branch {
                name: "agent/x".into(),
            },
            commit: None,
        };
        assert_eq!(
            ReviewKey::of(&checkout),
            Some(ReviewKey {
                project: "/code/drive-web/.git".into(),
                branch: "agent/x".into(),
            })
        );
        checkout.head = Head::Detached {
            commit: "4e1b2a0".into(),
        };
        assert_eq!(ReviewKey::of(&checkout), None);
    }

    #[test]
    fn a_mark_the_agent_left_is_kept_until_the_window_has_seen_it() {
        let mut marked = comment("a", Some(Resolution::ByAgent));
        marked.note = Some("Renamed it.".into());
        let kept = SavedReview {
            comments: vec![marked.clone(), comment("b", Some(Resolution::ByAgent))],
            ..SavedReview::default()
        };
        let mut edited = comment("b", None);
        edited.text = "Not quite.".into();
        let window = SavedReview {
            comments: vec![comment("a", None), edited.clone(), comment("c", None)],
            ..SavedReview::default()
        };
        let saved = window.keeping_agent_marks(&kept);
        assert_eq!(saved.comments, [marked, edited, comment("c", None)]);
    }

    #[test]
    fn a_mark_the_reviewer_accepted_stays_theirs() {
        let kept = SavedReview {
            comments: vec![comment("a", Some(Resolution::ByAgent))],
            ..SavedReview::default()
        };
        let window = SavedReview {
            comments: vec![comment("a", Some(Resolution::ByReviewer))],
            ..SavedReview::default()
        };
        assert_eq!(window.clone().keeping_agent_marks(&kept), window);
    }

    #[test]
    fn a_review_with_a_base_alone_is_empty() {
        let review = SavedReview {
            base: Some(Base::LastCommit),
            seen: Some(Seen {
                commit: "abc".into(),
                at: 1,
            }),
            ..SavedReview::default()
        };
        assert!(review.is_empty());
    }

    #[test]
    fn a_summary_counts_open_comments() {
        let review = SavedReview {
            comments: vec![
                comment("a", None),
                comment("b", Some(Resolution::ByReviewer)),
                comment("c", None),
            ],
            rounds: vec![round(1, 10), round(2, 20)],
            ..SavedReview::default()
        };
        assert_eq!(review.summary().open, 2);
        assert_eq!(SavedReview::default().summary().open, 0);
    }

    #[test]
    fn a_review_with_a_comment_or_a_round_is_not_empty() {
        assert!(SavedReview::default().is_empty());
        let comment = SavedReview {
            comments: vec![comment("c", None)],
            ..SavedReview::default()
        };
        assert!(!comment.is_empty());
        let round = SavedReview {
            rounds: vec![round(1, 0)],
            ..SavedReview::default()
        };
        assert!(!round.is_empty());
    }
}
