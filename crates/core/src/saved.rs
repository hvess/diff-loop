//! What of a review outlasts a run of the app, and the port to where it is kept.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::{
    anchor::Comment,
    base::Base,
    repository::{Checkout, Head},
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

    /// What the review switcher says of it (ADR 0026 §7). O(comments).
    #[must_use]
    pub fn summary(&self) -> ReviewSummary {
        let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
        ReviewSummary {
            comments: count(self.comments.len()),
            open: count(
                self.comments
                    .iter()
                    .filter(|c| c.resolved.is_none())
                    .count(),
            ),
            round: self.rounds.last().map(|r| RoundSummary {
                number: r.number,
                at: r.at,
            }),
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

/// What the review switcher lists of a kept review ([`SavedReview::summary`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReviewSummary {
    /// Every comment, resolved ones included.
    pub comments: u32,
    /// The comments not resolved.
    pub open: u32,
    /// The latest round, if one was sent.
    pub round: Option<RoundSummary>,
    /// As [`SavedReview::seen`].
    pub seen: Option<Seen>,
}

/// A round as the review switcher names it: "Round 2 sent · 10 min ago".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoundSummary {
    /// As [`Round::number`].
    pub number: u32,
    /// As [`Round::at`].
    #[ts(type = "number")]
    pub at: i64,
}

/// Where reviews are kept between runs, by [`ReviewKey`].
pub trait ReviewStore {
    /// The review saved for `key`, or an empty one when none is.
    ///
    /// # Errors
    /// [`StoreError::Failed`] when what is kept cannot be read.
    fn saved(&self, key: &ReviewKey) -> Result<SavedReview, StoreError>;

    /// Keeps `review` for `key` in place of any before it; an empty review
    /// removes the entry.
    ///
    /// # Errors
    /// [`StoreError::Failed`] when it cannot be written, or when what is
    /// kept cannot be read, so writing would lose it.
    fn save(&self, key: &ReviewKey, review: &SavedReview) -> Result<(), StoreError>;

    /// Every review kept, in key order. A store keeping reviews apart may
    /// leave out one it cannot read, so that it hides no other; [`Self::saved`]
    /// reports it.
    ///
    /// # Errors
    /// [`StoreError::Failed`] when what is kept cannot be read.
    fn kept(&self) -> Result<Vec<(ReviewKey, SavedReview)>, StoreError>;
}

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
    use crate::anchor::{AnchorState, Place, Resolution, Target};

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
    fn a_summary_counts_open_comments_and_names_the_latest_round() {
        let review = SavedReview {
            comments: vec![
                comment("a", None),
                comment("b", Some(Resolution::ByReviewer)),
                comment("c", None),
            ],
            rounds: vec![round(1, 10), round(2, 20)],
            ..SavedReview::default()
        };
        let summary = review.summary();
        assert_eq!((summary.comments, summary.open), (3, 2));
        assert_eq!(summary.round, Some(RoundSummary { number: 2, at: 20 }));
        assert_eq!(SavedReview::default().summary().round, None);
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
